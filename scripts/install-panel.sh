#!/usr/bin/env bash
# MC Manage Panel — Panel Installer
# Supported: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12
#
# One-liner install:
#   bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-panel.sh)

set -euo pipefail

# ────────────────────────────── Colors ──────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${CYAN}•${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
error()   { echo -e "\n  ${RED}✖ ERROR:${NC} $*\n" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}┌─ $* ${NC}"; }

# ────────────────────────────── Defaults ──────────────────────────────
PANEL_DIR="/var/www/mc-panel"
PANEL_USER="mcpanel"
NODE_VERSION="20"
REPO_URL="https://github.com/mwlih28/mc-manage-panel"
BRANCH="claude/pterodactyl-panel-builder-8uy3tp"

# ────────────────────────────── Banner ──────────────────────────────
echo -e "\n${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║       MC Manage Panel — Installer v1.0            ║"
echo "  ║        Game Server Management Platform            ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ────────────────────────────── Pre-flight ──────────────────────────────
[[ $EUID -ne 0 ]] && error "This script must be run as root.\n  Try: sudo bash $0"

[[ -f /etc/os-release ]] || error "Cannot detect OS."
. /etc/os-release
OS_ID="$ID"
OS_VER="$VERSION_ID"

case "$OS_ID" in
  ubuntu|debian) ;;
  *) error "Unsupported OS: $OS_ID. This installer supports Ubuntu 20/22/24 and Debian 11/12." ;;
esac

info "OS: ${OS_ID} ${OS_VER}"

# ────────────────────────────── Collect inputs ──────────────────────────────
step "Configuration"

echo ""
read -rp "  Panel domain (e.g. panel.yourdomain.com): " PANEL_DOMAIN
[[ -z "$PANEL_DOMAIN" ]] && error "Domain is required."

read -rp "  Admin email: " ADMIN_EMAIL
[[ -z "$ADMIN_EMAIL" ]] && error "Email is required."

read -rp "  Admin username [admin]: " ADMIN_USERNAME
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"

read -rp "  Admin first name [Admin]: " ADMIN_FIRSTNAME
ADMIN_FIRSTNAME="${ADMIN_FIRSTNAME:-Admin}"

read -rp "  Admin last name [User]: " ADMIN_LASTNAME
ADMIN_LASTNAME="${ADMIN_LASTNAME:-User}"

while true; do
  read -rsp "  Admin password (min 8 chars): " ADMIN_PASSWORD; echo
  [[ ${#ADMIN_PASSWORD} -ge 8 ]] && break
  warn "Password must be at least 8 characters."
done

read -rp "  Setup SSL with Let's Encrypt? [Y/n]: " SETUP_SSL
SETUP_SSL="${SETUP_SSL:-y}"

echo ""
echo -e "  ${BOLD}Summary:${NC}"
echo "    Domain  : $PANEL_DOMAIN"
echo "    Email   : $ADMIN_EMAIL"
echo "    Username: $ADMIN_USERNAME"
echo "    SSL     : $SETUP_SSL"
echo ""
read -rp "  Proceed? [Y/n]: " CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && { echo "Aborted."; exit 0; }

# Generate secrets
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
DB_NAME="mcpanel"
DB_USER="mcpanel"

# ────────────────────────────── System packages ──────────────────────────────
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q \
  curl wget git openssl \
  software-properties-common apt-transport-https \
  ca-certificates gnupg lsb-release nginx
success "System packages installed"

# ────────────────────────────── Node.js 20 ──────────────────────────────
step "Installing Node.js ${NODE_VERSION}+"
CURRENT_NODE_MAJOR=0
if command -v node &>/dev/null; then
  CURRENT_NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
fi
if [[ "$CURRENT_NODE_MAJOR" -lt "$NODE_VERSION" ]]; then
  info "Installing Node.js ${NODE_VERSION} via NodeSource..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
else
  info "Node.js $(node --version) already installed (>= ${NODE_VERSION})"
fi
success "Node $(node --version), npm $(npm --version)"

# ────────────────────────────── PostgreSQL ──────────────────────────────
step "Setting up PostgreSQL"
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql postgresql-contrib >/dev/null
fi
systemctl enable postgresql --now

# Create role (idempotent)
sudo -u postgres psql -qtc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" >/dev/null

# Create database (idempotent)
sudo -u postgres psql -qtc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"

# Grants (PostgreSQL 15+ requires explicit schema grant)
sudo -u postgres psql -d "${DB_NAME}" \
  -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null 2>&1 || true
sudo -u postgres psql -d "${DB_NAME}" \
  -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" >/dev/null 2>&1 || true

success "PostgreSQL: database='${DB_NAME}' user='${DB_USER}'"

# ────────────────────────────── Panel user ──────────────────────────────
step "Creating service user"
id -u "$PANEL_USER" &>/dev/null \
  || useradd -r -m -d "$PANEL_DIR" -s /usr/sbin/nologin "$PANEL_USER"
success "User '${PANEL_USER}' ready"

# ────────────────────────────── Clone / update source ──────────────────────────────
step "Fetching panel source"
if [[ -d "${PANEL_DIR}/.git" ]]; then
  info "Updating existing installation..."
  git -C "$PANEL_DIR" fetch origin --quiet
  git -C "$PANEL_DIR" reset --hard "origin/${BRANCH}" --quiet
elif [[ -d "${PANEL_DIR}" ]]; then
  # Directory exists but is not a git repo (e.g. partial previous install)
  info "Removing incomplete directory and re-cloning..."
  rm -rf "$PANEL_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PANEL_DIR" --quiet
else
  info "Cloning from ${REPO_URL} ..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PANEL_DIR" --quiet
fi
success "Source at ${PANEL_DIR}"

# ────────────────────────────── Write .env (before build) ──────────────────────────────
step "Writing API environment"
cat > "${PANEL_DIR}/apps/api/.env" <<ENV
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://${PANEL_DOMAIN}
APP_NAME=MC Manage Panel
APP_URL=https://${PANEL_DOMAIN}
PANEL_VERSION=1.0.0
ENV
chmod 600 "${PANEL_DIR}/apps/api/.env"
success ".env written"

# ────────────────────────────── Build API ──────────────────────────────
step "Installing and building API"
cd "${PANEL_DIR}/apps/api"
# Remove the Railway-generated lock file so npm resolves packages fresh on this system
rm -f package-lock.json
info "npm install..."
npm install --no-fund --no-audit
# Verify prisma binary exists
[[ -x ./node_modules/.bin/prisma ]] \
  || error "Prisma binary not found after npm install. Check npm output above."
info "Generating Prisma client..."
./node_modules/.bin/prisma generate
info "Compiling TypeScript..."
npm run build
success "API built → ${PANEL_DIR}/apps/api/dist"

# ────────────────────────────── Build Web ──────────────────────────────
step "Installing and building Web"
cd "${PANEL_DIR}/apps/web"
rm -f package-lock.json
info "npm install..."
npm install --no-fund --no-audit
info "Building frontend (VITE_API_URL=https://${PANEL_DOMAIN})..."
VITE_API_URL="https://${PANEL_DOMAIN}" npm run build
success "Web built → ${PANEL_DIR}/apps/web/dist"

# ────────────────────────────── Database schema ──────────────────────────────
step "Applying database schema"
cd "${PANEL_DIR}/apps/api"
./node_modules/.bin/prisma db push --accept-data-loss
success "Schema applied"

# ────────────────────────────── Create admin account ──────────────────────────────
step "Creating admin account"
# Pass credentials via env vars to avoid shell-quoting issues with special chars
SEED_EMAIL="$ADMIN_EMAIL" \
SEED_USERNAME="$ADMIN_USERNAME" \
SEED_PASSWORD="$ADMIN_PASSWORD" \
SEED_FIRSTNAME="$ADMIN_FIRSTNAME" \
SEED_LASTNAME="$ADMIN_LASTNAME" \
SEED_APP_URL="https://${PANEL_DOMAIN}" \
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash(process.env.SEED_PASSWORD, 12);
  await prisma.user.upsert({
    where:  { email: process.env.SEED_EMAIL },
    update: {
      password: hash,
      firstName: process.env.SEED_FIRSTNAME,
      lastName:  process.env.SEED_LASTNAME,
      role: 'ADMIN', rootAdmin: true,
    },
    create: {
      email:     process.env.SEED_EMAIL,
      username:  process.env.SEED_USERNAME,
      password:  hash,
      firstName: process.env.SEED_FIRSTNAME,
      lastName:  process.env.SEED_LASTNAME,
      role: 'ADMIN', rootAdmin: true,
    },
  });
  const settings = [
    { key: 'app:name',            value: 'MC Manage Panel' },
    { key: 'app:url',             value: process.env.SEED_APP_URL },
    { key: 'app:version',         value: '1.0.0' },
    { key: 'recaptcha:enabled',   value: 'false' },
  ];
  for (const s of settings) {
    await prisma.setting.upsert({ where: { key: s.key }, update: { value: s.value }, create: s });
  }
  console.log('Admin account ready: ' + process.env.SEED_EMAIL);
  await prisma.\$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
"
success "Admin account created: ${ADMIN_EMAIL}"

# ────────────────────────────── Permissions ──────────────────────────────
chown -R "${PANEL_USER}:${PANEL_USER}" "$PANEL_DIR"
chmod 750 "${PANEL_DIR}/apps/api/dist"

# ────────────────────────────── Systemd service ──────────────────────────────
step "Creating systemd service"
NODE_BIN="$(which node)"
cat > /etc/systemd/system/mc-panel.service <<SERVICE
[Unit]
Description=MC Manage Panel API
Documentation=https://github.com/mwlih28/mc-manage-panel
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${PANEL_USER}
WorkingDirectory=${PANEL_DIR}/apps/api
ExecStart=${NODE_BIN} dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mc-panel
# Env is loaded by dotenv from .env file in WorkingDirectory

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable mc-panel --quiet
systemctl restart mc-panel
sleep 2

if systemctl is-active --quiet mc-panel; then
  success "mc-panel service running"
else
  warn "mc-panel service failed to start. Check: journalctl -u mc-panel -n 50"
fi

# ────────────────────────────── Nginx ──────────────────────────────
step "Configuring Nginx"
cat > /etc/nginx/sites-available/mc-panel <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${PANEL_DOMAIN};

    root ${PANEL_DIR}/apps/web/dist;
    index index.html;

    client_max_body_size 100m;

    # React SPA — all non-file paths serve index.html
    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Immutable static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API reverse proxy
    location /api/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    # WebSocket (Socket.io console/stats)
    location /socket.io/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       \$host;
        proxy_set_header   X-Real-IP  \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 3600s;
    }
}
NGINX

# Enable and reload
ln -sf /etc/nginx/sites-available/mc-panel /etc/nginx/sites-enabled/mc-panel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
success "Nginx configured for ${PANEL_DOMAIN}"

# ────────────────────────────── SSL ──────────────────────────────
if [[ "${SETUP_SSL,,}" != "n" ]]; then
  step "Setting up SSL (Let's Encrypt)"
  apt-get install -y certbot python3-certbot-nginx >/dev/null
  if certbot --nginx -d "$PANEL_DOMAIN" \
      --non-interactive --agree-tos \
      --email "$ADMIN_EMAIL" \
      --redirect 2>/dev/null; then
    success "SSL certificate installed — HTTPS enabled"
    # Update CORS_ORIGIN (already https)
  else
    warn "Certbot failed. Make sure ${PANEL_DOMAIN} points to this server's IP."
    warn "You can retry later: certbot --nginx -d ${PANEL_DOMAIN}"
  fi
fi

# ────────────────────────────── Firewall ──────────────────────────────
step "Configuring firewall (UFW)"
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   comment "SSH"    >/dev/null 2>&1 || true
  ufw allow 80/tcp   comment "HTTP"   >/dev/null 2>&1 || true
  ufw allow 443/tcp  comment "HTTPS"  >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  success "UFW enabled: ports 22, 80, 443 open"
else
  info "UFW not found — skipping firewall config"
fi

# ────────────────────────────── Done ──────────────────────────────
SCHEME="http"
[[ "${SETUP_SSL,,}" != "n" ]] && SCHEME="https"

echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║          Installation Complete! 🎉                ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Panel URL:${NC}      ${SCHEME}://${PANEL_DOMAIN}"
echo -e "  ${BOLD}Admin email:${NC}    ${ADMIN_EMAIL}"
echo -e "  ${BOLD}Admin password:${NC} (the one you entered)"
echo ""
echo -e "  ${BOLD}Service management:${NC}"
echo "    systemctl status  mc-panel"
echo "    systemctl restart mc-panel"
echo "    journalctl -u mc-panel -f"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo "  1. Open ${SCHEME}://${PANEL_DOMAIN} and sign in"
echo "  2. Go to Admin → Nodes → New Node to add a game server"
echo "  3. Copy the node token, then on your game server run:"
echo ""
echo -e "  ${CYAN}bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/${BRANCH}/scripts/install-wings.sh)${NC}"
echo ""
