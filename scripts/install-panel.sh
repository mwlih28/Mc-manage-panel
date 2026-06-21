#!/usr/bin/env bash
# MC Manage Panel - Panel Installation Script
# Supports: Ubuntu 20.04/22.04/24.04, Debian 11/12
# Usage: bash <(curl -s https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-panel.sh)

set -euo pipefail
IFS=$'\n\t'

# ─────────── Colors ───────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ─────────── Helpers ───────────
info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}"; }

PANEL_DIR="/var/www/mc-panel"
PANEL_USER="mcpanel"
NODE_VERSION="20"
REPO="https://github.com/mwlih28/mc-manage-panel"

# ─────────── Banner ───────────
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║          MC Manage Panel — Installer v1.0            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─────────── Root check ───────────
[[ $EUID -ne 0 ]] && error "This script must be run as root. Try: sudo bash install-panel.sh"

# ─────────── OS detection ───────────
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS_NAME="$ID"
  OS_VER="$VERSION_ID"
else
  error "Cannot detect OS. Supported: Ubuntu 20/22/24, Debian 11/12"
fi

info "Detected OS: ${OS_NAME} ${OS_VER}"

case "$OS_NAME" in
  ubuntu|debian) ;;
  *) error "Unsupported OS: $OS_NAME. Use Ubuntu or Debian." ;;
esac

# ─────────── Collect inputs ───────────
step "Configuration"

read -rp "$(echo -e "${CYAN}Panel domain (e.g. panel.yourdomain.com):${NC} ")" PANEL_DOMAIN
[[ -z "$PANEL_DOMAIN" ]] && error "Domain is required"

read -rp "$(echo -e "${CYAN}Panel admin email:${NC} ")" ADMIN_EMAIL
[[ -z "$ADMIN_EMAIL" ]] && error "Email is required"

read -rsp "$(echo -e "${CYAN}Admin password (min 8 chars):${NC} ")" ADMIN_PASSWORD; echo
[[ ${#ADMIN_PASSWORD} -lt 8 ]] && error "Password must be at least 8 characters"

read -rp "$(echo -e "${CYAN}Admin first name [Admin]:${NC} ")" ADMIN_FIRSTNAME
ADMIN_FIRSTNAME="${ADMIN_FIRSTNAME:-Admin}"

read -rp "$(echo -e "${CYAN}Admin last name [User]:${NC} ")" ADMIN_LASTNAME
ADMIN_LASTNAME="${ADMIN_LASTNAME:-User}"

read -rp "$(echo -e "${CYAN}Install SSL with Let's Encrypt? [y/N]:${NC} ")" INSTALL_SSL
INSTALL_SSL="${INSTALL_SSL:-n}"

DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)

echo ""
info "Panel Domain: $PANEL_DOMAIN"
info "Admin Email: $ADMIN_EMAIL"
info "SSL: $INSTALL_SSL"
echo ""
read -rp "$(echo -e "${YELLOW}Continue? [Y/n]:${NC} ")" CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && exit 0

# ─────────── System update ───────────
step "Updating system packages"
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget git unzip tar software-properties-common apt-transport-https ca-certificates gnupg lsb-release

# ─────────── Node.js ───────────
step "Installing Node.js ${NODE_VERSION}"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
NODE_VER=$(node --version)
success "Node.js installed: $NODE_VER"

# ─────────── PostgreSQL ───────────
step "Installing PostgreSQL"
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql postgresql-contrib
fi
systemctl enable postgresql --now

# Create database and user
DB_NAME="mcpanel"
DB_USER="mcpanel"

sudo -u postgres psql <<PSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = '${DB_USER}') THEN
    CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
CREATE DATABASE IF NOT EXISTS ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
PSQL

# PostgreSQL 15+ needs schema grant
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" 2>/dev/null || true

success "PostgreSQL configured: database=${DB_NAME}, user=${DB_USER}"

# ─────────── Nginx ───────────
step "Installing Nginx"
apt-get install -y nginx
systemctl enable nginx --now

# ─────────── Create panel user ───────────
step "Creating panel user"
if ! id -u "$PANEL_USER" &>/dev/null; then
  useradd -r -d "$PANEL_DIR" -s /bin/bash "$PANEL_USER"
fi

# ─────────── Clone/install panel ───────────
step "Installing Panel"
mkdir -p "$PANEL_DIR"

if [[ -d "$PANEL_DIR/.git" ]]; then
  info "Updating existing installation..."
  git -C "$PANEL_DIR" pull origin main
else
  info "Cloning repository..."
  git clone "$REPO" "$PANEL_DIR"
fi

cd "$PANEL_DIR"

# Install dependencies
info "Installing dependencies..."
npm install --prefix apps/api --omit=dev --quiet
npm install --prefix apps/web --quiet

# Build frontend
info "Building frontend..."
VITE_API_URL="https://${PANEL_DOMAIN}" npm run build --prefix apps/web

# ─────────── Create .env ───────────
step "Configuring environment"
cat > "$PANEL_DIR/apps/api/.env" <<ENV
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://${PANEL_DOMAIN}
APP_NAME=MC Manage Panel
APP_URL=https://${PANEL_DOMAIN}
PANEL_VERSION=1.0.0
ENV

# ─────────── Database migration ───────────
step "Running database migrations"
cd "$PANEL_DIR/apps/api"
npx prisma generate
npx prisma db push --accept-data-loss

# ─────────── Seed admin user ───────────
step "Creating admin account"
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function seed() {
  const hash = await bcrypt.hash('${ADMIN_PASSWORD}', 12);
  const user = await prisma.user.upsert({
    where: { email: '${ADMIN_EMAIL}' },
    update: {},
    create: {
      email: '${ADMIN_EMAIL}',
      username: 'admin',
      password: hash,
      firstName: '${ADMIN_FIRSTNAME}',
      lastName: '${ADMIN_LASTNAME}',
      role: 'ADMIN',
      rootAdmin: true,
    },
  });

  const settings = [
    { key: 'app:name', value: 'MC Manage Panel' },
    { key: 'app:url', value: 'https://${PANEL_DOMAIN}' },
  ];
  for (const s of settings) {
    await prisma.setting.upsert({ where: { key: s.key }, update: s, create: s });
  }

  console.log('Admin created: ' + user.email);
  await prisma.\$disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
"

chown -R "$PANEL_USER:$PANEL_USER" "$PANEL_DIR"

# ─────────── Systemd service ───────────
step "Creating systemd service"
cat > /etc/systemd/system/mc-panel.service <<SERVICE
[Unit]
Description=MC Manage Panel API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${PANEL_USER}
WorkingDirectory=${PANEL_DIR}/apps/api
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mc-panel
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

# Build TS
cd "$PANEL_DIR/apps/api"
npx tsc

systemctl daemon-reload
systemctl enable mc-panel
systemctl start mc-panel
success "Panel service started"

# ─────────── Nginx config ───────────
step "Configuring Nginx"
cat > /etc/nginx/sites-available/mc-panel <<NGINX
server {
    listen 80;
    server_name ${PANEL_DOMAIN};
    root ${PANEL_DIR}/apps/web/dist;
    index index.html;

    client_max_body_size 100m;

    # Frontend (React SPA)
    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    # Static assets cache
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300;
    }

    # WebSocket proxy (Socket.io)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/mc-panel /etc/nginx/sites-enabled/mc-panel
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
success "Nginx configured"

# ─────────── SSL ───────────
if [[ "${INSTALL_SSL,,}" == "y" ]]; then
  step "Installing SSL certificate"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$PANEL_DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" || warn "SSL setup failed, check DNS"
fi

# ─────────── Firewall ───────────
step "Configuring firewall"
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   >/dev/null 2>&1 || true
  ufw allow 80/tcp   >/dev/null 2>&1 || true
  ufw allow 443/tcp  >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  success "UFW configured (ports 22, 80, 443 open)"
fi

# ─────────── Done ───────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║         Installation Complete!                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${BOLD}Panel URL:${NC}     http${INSTALL_SSL:+s}://${PANEL_DOMAIN}"
echo -e "${BOLD}Admin Email:${NC}   ${ADMIN_EMAIL}"
echo -e "${BOLD}Admin Pass:${NC}    (the one you entered)"
echo ""
echo -e "${BOLD}Service:${NC}       systemctl status mc-panel"
echo -e "${BOLD}Logs:${NC}          journalctl -u mc-panel -f"
echo ""
echo -e "${YELLOW}Next step:${NC} Install Wings on your game server nodes:"
echo "  bash <(curl -s https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-wings.sh)"
echo ""
