#!/usr/bin/env bash
# Kretase — Panel Installer
# Supported: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12
#
# One-liner install:
#   bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-panel.sh)

set -euo pipefail

# ── Colors & helpers ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${CYAN}•${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
error()   { echo -e "\n  ${RED}✖ ERROR:${NC} $*\n" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}┌─ $* ${NC}"; }

# ── Defaults ──────────────────────────────────────────────────────────
PANEL_DIR="/var/www/mc-panel"
PANEL_USER="mcpanel"
NODE_VERSION="20"
REPO_URL="https://github.com/mwlih28/mc-manage-panel"
BRANCH="main"
MIN_DISK_GB=5
MIN_RAM_MB=512
DB_NAME="mcpanel"
DB_USER="mcpanel"
SSL_OK="false"
SSL_ATTEMPTED="false"
SCHEME="http"

# ── Lock file (prevent parallel installs) ────────────────────────────
LOCKFILE="/tmp/mc-panel-install.lock"
if [[ -f "$LOCKFILE" ]]; then
  error "Another install may be in progress.\n  If it crashed, remove the lock and retry: rm -f $LOCKFILE"
fi
touch "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT INT TERM

# ── Install log ───────────────────────────────────────────────────────
LOGFILE="/var/log/mc-panel-install.log"
mkdir -p /var/log
exec > >(tee -a "$LOGFILE") 2>&1
echo "──── Install started: $(date) ────"

# ── Banner ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║            Kretase — Installer v1.0               ║"
echo "  ║        Game Server Management Platform            ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  Install log: ${CYAN}${LOGFILE}${NC}"

# ── Root check ────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"

# ── OS check ──────────────────────────────────────────────────────────
[[ -f /etc/os-release ]] || error "Cannot detect OS."
. /etc/os-release
OS_ID="$ID"
OS_VER="$VERSION_ID"
case "$OS_ID" in
  ubuntu|debian) ;;
  *) error "Unsupported OS: $OS_ID (supports Ubuntu 20/22/24, Debian 11/12)" ;;
esac
info "OS: ${OS_ID} ${OS_VER}"

# ── Detect public IP ──────────────────────────────────────────────────
SERVER_IP=$(curl -4 -sf --max-time 5 https://api.ipify.org 2>/dev/null \
  || curl -4 -sf --max-time 5 https://ifconfig.me 2>/dev/null \
  || hostname -I | awk '{print $1}' || echo "unknown")
info "Server IP: ${SERVER_IP}"

# ── Disk & RAM pre-flight ─────────────────────────────────────────────
AVAIL_DISK_GB=$(df -BG / | awk 'NR==2{gsub(/G/,"",$4); print $4}')
[[ "${AVAIL_DISK_GB:-0}" -lt "$MIN_DISK_GB" ]] && \
  error "Not enough disk space: ${AVAIL_DISK_GB}GB available, ${MIN_DISK_GB}GB required."
info "Disk: ${AVAIL_DISK_GB}GB available"

AVAIL_RAM_MB=$(awk '/MemAvailable/{ printf "%d", $2/1024 }' /proc/meminfo)
[[ "${AVAIL_RAM_MB:-0}" -lt "$MIN_RAM_MB" ]] && \
  warn "Low RAM: ${AVAIL_RAM_MB}MB available (${MIN_RAM_MB}MB+ recommended). Continuing."
info "RAM: ${AVAIL_RAM_MB}MB available"

# ── Port conflict check ───────────────────────────────────────────────
for PORT_CHECK in 80 443 3001; do
  if ss -tlnp | grep -q ":${PORT_CHECK} "; then
    warn "Port ${PORT_CHECK} is already in use — may conflict."
  fi
done

# ── Collect inputs ────────────────────────────────────────────────────
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
echo -e "  ${CYAN}${BOLD}Optional:${NC} Get notified about updates"
read -rp "  Email for update notifications (or Enter to skip): " INSTALLER_EMAIL
INSTALLER_NAME=""
NOTIFY_UPDATES="false"
[[ -n "$INSTALLER_EMAIL" ]] && NOTIFY_UPDATES="true"

echo ""
echo -e "  ${BOLD}Summary:${NC}"
echo "    Domain    : $PANEL_DOMAIN"
echo "    Email     : $ADMIN_EMAIL"
echo "    Username  : $ADMIN_USERNAME"
echo "    Server IP : $SERVER_IP"
echo "    SSL       : $SETUP_SSL"
echo ""
read -rp "  Proceed? [Y/n]: " CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && { echo "Aborted."; exit 0; }

# Generate secrets
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)

# ── System packages ───────────────────────────────────────────────────
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q \
  curl wget git openssl dnsutils \
  software-properties-common apt-transport-https \
  ca-certificates gnupg lsb-release nginx
success "System packages installed"

# ── Node.js ───────────────────────────────────────────────────────────
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

# ── PostgreSQL ────────────────────────────────────────────────────────
step "Setting up PostgreSQL"
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql postgresql-contrib >/dev/null
fi
systemctl enable postgresql --now

# Helper: run postgres commands from /tmp to avoid "permission denied /root"
PG() { cd /tmp && sudo -u postgres "$@"; cd - >/dev/null; }

if PG psql -qtc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" 2>/dev/null | grep -q 1; then
  PG psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" >/dev/null
else
  PG psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" >/dev/null
fi

PG psql -qtc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null | grep -q 1 \
  || PG createdb -O "${DB_USER}" "${DB_NAME}"

PG psql -d "${DB_NAME}" -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null 2>&1 || true
PG psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" >/dev/null 2>&1 || true
success "PostgreSQL ready: database='${DB_NAME}' user='${DB_USER}'"

# ── Panel service user ────────────────────────────────────────────────
step "Creating service user"
id -u "$PANEL_USER" &>/dev/null \
  || useradd -r -m -d "$PANEL_DIR" -s /usr/sbin/nologin "$PANEL_USER"
success "User '${PANEL_USER}' ready"

# ── Clone / update source ─────────────────────────────────────────────
step "Fetching panel source"
git config --global --add safe.directory "$PANEL_DIR" 2>/dev/null || true
if [[ -d "${PANEL_DIR}/.git" ]]; then
  info "Updating existing installation..."
  git -C "$PANEL_DIR" fetch origin "${BRANCH}" --quiet
  git -C "$PANEL_DIR" reset --hard FETCH_HEAD --quiet
elif [[ -d "${PANEL_DIR}" ]]; then
  info "Removing incomplete directory and re-cloning..."
  rm -rf "$PANEL_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PANEL_DIR" --quiet
else
  info "Cloning from ${REPO_URL}..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PANEL_DIR" --quiet
fi
success "Source at ${PANEL_DIR}"

# ── Write .env (http:// — updated to https:// only if SSL succeeds) ───
step "Writing API environment"
cat > "${PANEL_DIR}/apps/api/.env" <<ENV
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=http://${PANEL_DOMAIN}
APP_NAME=Kretase
APP_URL=http://${PANEL_DOMAIN}
PANEL_VERSION=1.0.0
ENV
chmod 600 "${PANEL_DIR}/apps/api/.env"
success ".env written"

# ── Install dependencies (with retry) ────────────────────────────────
step "Installing dependencies"
cd "${PANEL_DIR}"
rm -f package-lock.json apps/api/package-lock.json apps/web/package-lock.json
NPM_OK=false
for attempt in 1 2 3; do
  if npm install --no-fund --no-audit; then NPM_OK=true; break; fi
  warn "npm install failed (attempt ${attempt}/3). Retrying in 10s..."
  sleep 10
done
$NPM_OK || error "npm install failed after 3 attempts. Check network connectivity."
PRISMA_BIN="${PANEL_DIR}/node_modules/.bin/prisma"
[[ -x "$PRISMA_BIN" ]] || error "Prisma binary not found after npm install."
success "Dependencies installed"

# ── Build API ─────────────────────────────────────────────────────────
step "Building API"
cd "${PANEL_DIR}/apps/api"
"$PRISMA_BIN" generate
PATH="${PANEL_DIR}/node_modules/.bin:$PATH" npm run build
success "API built → ${PANEL_DIR}/apps/api/dist"

# ── Build Web ─────────────────────────────────────────────────────────
step "Building Web"
info "Using relative API paths — works on any domain or IP via nginx proxy"
cd "${PANEL_DIR}/apps/web"
PATH="${PANEL_DIR}/node_modules/.bin:$PATH" npm run build
success "Web built → ${PANEL_DIR}/apps/web/dist"

# ── Database schema ───────────────────────────────────────────────────
step "Applying database schema"
cd "${PANEL_DIR}/apps/api"
# Backup existing data if tables already exist (upgrade scenario)
TABLE_COUNT=$(PG psql -d "${DB_NAME}" -qtc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" \
  2>/dev/null | tr -d ' \n' || echo 0)
if [[ "${TABLE_COUNT:-0}" -gt 0 ]]; then
  BACKUP_FILE="/tmp/mc-panel-db-$(date +%Y%m%d%H%M%S).sql"
  info "Existing database detected — backing up to ${BACKUP_FILE}..."
  PG pg_dump "${DB_NAME}" > "$BACKUP_FILE"
  success "Database backed up: $BACKUP_FILE"
fi
"$PRISMA_BIN" db push --accept-data-loss
success "Schema applied"

# ── Create admin account ──────────────────────────────────────────────
step "Creating admin account"
cd "${PANEL_DIR}"
SEED_EMAIL="$ADMIN_EMAIL" \
SEED_USERNAME="$ADMIN_USERNAME" \
SEED_PASSWORD="$ADMIN_PASSWORD" \
SEED_FIRSTNAME="$ADMIN_FIRSTNAME" \
SEED_LASTNAME="$ADMIN_LASTNAME" \
SEED_APP_URL="http://${PANEL_DOMAIN}" \
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash(process.env.SEED_PASSWORD, 12);
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: process.env.SEED_EMAIL }, { username: process.env.SEED_USERNAME }] }
  });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        email:     process.env.SEED_EMAIL,
        password:  hash,
        firstName: process.env.SEED_FIRSTNAME,
        lastName:  process.env.SEED_LASTNAME,
        role: 'ADMIN', rootAdmin: true,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        email:     process.env.SEED_EMAIL,
        username:  process.env.SEED_USERNAME,
        password:  hash,
        firstName: process.env.SEED_FIRSTNAME,
        lastName:  process.env.SEED_LASTNAME,
        role: 'ADMIN', rootAdmin: true,
      },
    });
  }
  const settings = [
    { key: 'app:name',          value: 'Kretase' },
    { key: 'app:url',           value: process.env.SEED_APP_URL },
    { key: 'app:version',       value: '1.0.0' },
    { key: 'recaptcha:enabled', value: 'false' },
  ];
  for (const s of settings) {
    await prisma.setting.upsert({ where: { key: s.key }, update: { value: s.value }, create: s });
  }
  console.log('Admin account ready: ' + process.env.SEED_EMAIL);
  await prisma.\$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
"
success "Admin account created: ${ADMIN_EMAIL}"

# ── Optional: Email Setup (Resend) ────────────────────────────────────
step "Email Setup (optional)"
echo ""
echo -e "  Configure email so your panel can send notifications to users."
echo -e "  ${CYAN}Recommended:${NC} Resend.com — free plan includes 3,000 emails/month"
echo ""
read -rp "  Set up email now? (y/N): " DO_EMAIL
DO_EMAIL="${DO_EMAIL:-n}"

if [[ "${DO_EMAIL,,}" == "y" ]]; then
  echo ""
  echo -e "  ${BOLD}Step 1:${NC} Sign up at https://resend.com (free)"
  echo -e "  ${BOLD}Step 2:${NC} Create an API key in Resend dashboard"
  echo ""
  read -rp "  Resend API Key (re_...): " RESEND_API_KEY

  if [[ -z "$RESEND_API_KEY" ]]; then
    warn "No API key provided — skipping email setup. Configure later in Admin → Settings."
  else
    # Default: Resend's shared test address (works immediately, no domain needed)
    read -rp "  From address [onboarding@resend.dev]: " SMTP_FROM_INPUT
    SMTP_FROM="${SMTP_FROM_INPUT:-onboarding@resend.dev}"

    read -rp "  Your notification email [${ADMIN_EMAIL}]: " OWNER_EMAIL_INPUT
    OWNER_EMAIL="${OWNER_EMAIL_INPUT:-${ADMIN_EMAIL}}"

    # Write SMTP settings into DB via Prisma
    cd "${PANEL_DIR}"
    SMTP_HOST_VAL="smtp.resend.com" \
    SMTP_PORT_VAL="465" \
    SMTP_USER_VAL="resend" \
    SMTP_PASS_VAL="$RESEND_API_KEY" \
    SMTP_FROM_VAL="$SMTP_FROM" \
    SMTP_OWNER_VAL="$OWNER_EMAIL" \
    node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const entries = [
    { key: 'smtp.host',        value: process.env.SMTP_HOST_VAL },
    { key: 'smtp.port',        value: process.env.SMTP_PORT_VAL },
    { key: 'smtp.user',        value: process.env.SMTP_USER_VAL },
    { key: 'smtp.pass',        value: process.env.SMTP_PASS_VAL },
    { key: 'smtp.from',        value: process.env.SMTP_FROM_VAL },
    { key: 'smtp.owner_email', value: process.env.SMTP_OWNER_VAL },
  ];
  for (const e of entries) {
    await prisma.setting.upsert({ where: { key: e.key }, update: { value: e.value }, create: e });
  }
  console.log('SMTP settings saved to database');
  await prisma.\$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
"
    success "Email configured — using Resend SMTP (smtp.resend.com:465)"

    # ── Optional: auto-configure DNS via Cloudflare ─────────────────
    # Only relevant when using a custom domain (not @resend.dev)
    SMTP_DOMAIN=""
    if [[ "$SMTP_FROM" == *"@"* && "$SMTP_FROM" != *"@resend.dev"* ]]; then
      SMTP_DOMAIN=$(echo "$SMTP_FROM" | sed 's/.*@//' | tr -d '>')
    fi

    if [[ -n "$SMTP_DOMAIN" ]]; then
      echo ""
      echo -e "  ${CYAN}Optional:${NC} Auto-add SPF/DKIM/MX records for ${SMTP_DOMAIN} via Cloudflare API"
      echo "  Requires a Cloudflare API token with DNS Edit permission."
      read -rp "  Cloudflare API Token (or Enter to skip): " CF_TOKEN

      if [[ -n "$CF_TOKEN" ]]; then
        read -rp "  Cloudflare Zone ID: " CF_ZONE_ID

        if [[ -n "$CF_ZONE_ID" ]]; then
          info "Registering ${SMTP_DOMAIN} with Resend..."

          # Install jq if missing
          command -v jq &>/dev/null || apt-get install -y -q jq >/dev/null 2>&1 || true

          RESEND_RESP=$(curl -sf --max-time 15 -X POST "https://api.resend.com/domains" \
            -H "Authorization: Bearer ${RESEND_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"name\":\"${SMTP_DOMAIN}\"}" 2>/dev/null || echo "")

          if [[ -z "$RESEND_RESP" ]] || ! echo "$RESEND_RESP" | grep -q '"id"'; then
            warn "Could not register domain with Resend — add DNS records manually in Resend dashboard"
          else
            RESEND_DOMAIN_ID=$(echo "$RESEND_RESP" | grep -oP '"id":"\K[^"]+' | head -1)

            if command -v jq &>/dev/null; then
              DNS_ERRORS=0
              while IFS= read -r RECORD; do
                R_TYPE=$(echo "$RECORD" | jq -r '.type // empty')
                R_NAME=$(echo "$RECORD" | jq -r '.name // empty')
                R_VALUE=$(echo "$RECORD" | jq -r '.value // empty')
                R_PRIORITY=$(echo "$RECORD" | jq -r '.priority // empty')
                [[ -z "$R_TYPE" || -z "$R_NAME" || -z "$R_VALUE" ]] && continue

                if [[ "$R_TYPE" == "MX" && -n "$R_PRIORITY" ]]; then
                  CF_PAYLOAD="{\"type\":\"MX\",\"name\":\"${R_NAME}\",\"content\":\"${R_VALUE}\",\"priority\":${R_PRIORITY},\"ttl\":1,\"proxied\":false}"
                else
                  CF_PAYLOAD="{\"type\":\"${R_TYPE}\",\"name\":\"${R_NAME}\",\"content\":\"${R_VALUE}\",\"ttl\":1,\"proxied\":false}"
                fi

                CF_RESP=$(curl -sf --max-time 10 -X POST \
                  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
                  -H "Authorization: Bearer ${CF_TOKEN}" \
                  -H "Content-Type: application/json" \
                  -d "$CF_PAYLOAD" 2>/dev/null || echo "")

                if echo "$CF_RESP" | grep -q '"success":true'; then
                  info "DNS added: ${R_TYPE} ${R_NAME}"
                else
                  warn "DNS record skipped (may already exist): ${R_TYPE} ${R_NAME}"
                  DNS_ERRORS=$((DNS_ERRORS + 1))
                fi
              done < <(echo "$RESEND_RESP" | jq -c '.records[]?' 2>/dev/null)

              # Trigger Resend domain verification
              sleep 5
              VERIFY_RESP=$(curl -sf --max-time 10 -X POST \
                "https://api.resend.com/domains/${RESEND_DOMAIN_ID}/verify" \
                -H "Authorization: Bearer ${RESEND_API_KEY}" 2>/dev/null || echo "")

              if echo "$VERIFY_RESP" | grep -q '"status"'; then
                success "Domain ${SMTP_DOMAIN} verification triggered"
                info "DNS propagation may take up to 48h — check status at resend.com/domains"
              else
                warn "Verification trigger failed — check Resend dashboard manually"
              fi
            else
              warn "jq not available — add DNS records manually from Resend dashboard"
            fi
          fi
        else
          info "No Zone ID provided — add DNS records manually in Resend dashboard"
        fi
      else
        info "Cloudflare setup skipped — add DNS records manually in Resend dashboard"
      fi
    elif [[ "$SMTP_FROM" == *"@resend.dev"* ]]; then
      info "Using Resend test address — add your domain in Resend dashboard for branded emails"
    fi
  fi
else
  info "Email setup skipped — configure later in Admin → Settings → Email"
fi

# ── Permissions ───────────────────────────────────────────────────────
chown -R "${PANEL_USER}:${PANEL_USER}" "$PANEL_DIR"
chmod 750 "${PANEL_DIR}/apps/api/dist"

# ── Systemd service ───────────────────────────────────────────────────
step "Creating systemd service"
NODE_BIN="$(which node)"
cat > /etc/systemd/system/mc-panel.service <<SERVICE
[Unit]
Description=Kretase API
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

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable mc-panel --quiet
systemctl restart mc-panel

# Wait for API (up to 20s)
info "Waiting for API to start..."
API_READY=false
for i in {1..20}; do
  if curl -sf --max-time 2 http://127.0.0.1:3001/health >/dev/null 2>&1; then
    API_READY=true; break
  fi
  sleep 1
done
if $API_READY; then
  success "API is up and responding"
else
  warn "API did not respond in 20s. Continuing — check: journalctl -u mc-panel -n 50"
fi

# ── Nginx ─────────────────────────────────────────────────────────────
step "Configuring Nginx"
cat > /etc/nginx/sites-available/mc-panel <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${PANEL_DOMAIN};

    root ${PANEL_DIR}/apps/web/dist;
    index index.html;

    client_max_body_size 100m;

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

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

ln -sf /etc/nginx/sites-available/mc-panel /etc/nginx/sites-enabled/mc-panel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
success "Nginx configured for ${PANEL_DOMAIN}"

# ── SSL ───────────────────────────────────────────────────────────────
if [[ "${SETUP_SSL,,}" != "n" ]]; then
  SSL_ATTEMPTED="true"
  step "Setting up SSL (Let's Encrypt)"
  apt-get install -y certbot python3-certbot-nginx dnsutils >/dev/null 2>&1 || true

  # Check DNS resolves to this server before wasting certbot rate limits
  RESOLVED_IP=$(dig +short "${PANEL_DOMAIN}" A 2>/dev/null | tail -1 || echo "")
  if [[ -z "$RESOLVED_IP" ]]; then
    warn "DNS check: ${PANEL_DOMAIN} has no A record yet — skipping SSL."
    warn "Point ${PANEL_DOMAIN} → ${SERVER_IP}, then run:"
    warn "  certbot --nginx -d ${PANEL_DOMAIN} --email ${ADMIN_EMAIL} --agree-tos --redirect"
  elif [[ "$RESOLVED_IP" != "$SERVER_IP" ]]; then
    warn "DNS check: ${PANEL_DOMAIN} resolves to ${RESOLVED_IP}, expected ${SERVER_IP}."
    warn "Update the DNS A record, then run:"
    warn "  certbot --nginx -d ${PANEL_DOMAIN} --email ${ADMIN_EMAIL} --agree-tos --redirect"
  else
    info "DNS check passed: ${PANEL_DOMAIN} → ${RESOLVED_IP}"
    # Backup nginx config — certbot may modify it; restore on failure
    cp /etc/nginx/sites-available/mc-panel /etc/nginx/sites-available/mc-panel.bak

    if certbot --nginx -d "$PANEL_DOMAIN" \
        --non-interactive --agree-tos \
        --email "$ADMIN_EMAIL" \
        --redirect 2>/dev/null; then
      SSL_OK="true"
      SCHEME="https"
      success "SSL certificate installed — HTTPS enabled"
      rm -f /etc/nginx/sites-available/mc-panel.bak
      # Update CORS and APP_URL to https://
      sed -i "s|CORS_ORIGIN=http://|CORS_ORIGIN=https://|" "${PANEL_DIR}/apps/api/.env"
      sed -i "s|APP_URL=http://|APP_URL=https://|" "${PANEL_DIR}/apps/api/.env"
      systemctl restart mc-panel
      # Auto-renewal hook
      mkdir -p /etc/letsencrypt/renewal-hooks/deploy
      cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
      chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
      success "Certbot auto-renewal hook installed"
    else
      warn "Certbot failed — restoring original nginx config."
      cp /etc/nginx/sites-available/mc-panel.bak /etc/nginx/sites-available/mc-panel
      rm -f /etc/nginx/sites-available/mc-panel.bak
      nginx -t && systemctl reload nginx
    fi
  fi
fi

# ── IP fallback (SSL attempted but not active) ─────────────────────────
if [[ "$SSL_ATTEMPTED" = "true" && "$SSL_OK" != "true" ]]; then
  SCHEME="http"
  info "SSL not active — making panel accessible via IP: http://${SERVER_IP}"
  # Switch nginx to catch-all so any IP request is served
  sed -i "s|server_name ${PANEL_DOMAIN};|server_name _;|" /etc/nginx/sites-available/mc-panel
  # Escape dots in domain for sed safety
  SAFE_DOMAIN="${PANEL_DOMAIN//./\\.}"
  sed -i "s|CORS_ORIGIN=http://${SAFE_DOMAIN}|CORS_ORIGIN=http://${SERVER_IP}|" "${PANEL_DIR}/apps/api/.env"
  sed -i "s|APP_URL=http://${SAFE_DOMAIN}|APP_URL=http://${SERVER_IP}|" "${PANEL_DIR}/apps/api/.env"
  nginx -t && systemctl reload nginx
  systemctl restart mc-panel
  PANEL_DOMAIN="${SERVER_IP}"
fi

# ── Firewall ──────────────────────────────────────────────────────────
step "Configuring firewall (UFW)"
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   comment "SSH"   >/dev/null 2>&1 || true
  ufw allow 80/tcp   comment "HTTP"  >/dev/null 2>&1 || true
  ufw allow 443/tcp  comment "HTTPS" >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  success "UFW enabled: ports 22, 80, 443 open"
else
  info "UFW not found — skipping firewall"
fi

# ── Save installer config & send notifications ────────────────────────
# n8n webhook URL — buraya kendi n8n webhook adresinizi yazın
# n8n Cloud → Workflow 1 → Webhook node → Production URL
MC_PANEL_REGISTRY_URL="https://mcpanel.app.n8n.cloud/webhook/mc-panel-register"

INSTALLER_CONF_DIR="/etc/mc-panel"
mkdir -p "$INSTALLER_CONF_DIR"
cat > "${INSTALLER_CONF_DIR}/installer.conf" <<CONF
# Kretase — Installer configuration
# Do not delete — used by update and uninstall scripts
INSTALLED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
INSTALLED_VERSION="main"
PANEL_DIR="${PANEL_DIR}"
PANEL_USER="${PANEL_USER}"
PANEL_DOMAIN_ORIGINAL="${PANEL_DOMAIN}"
INSTALLER_NAME="${INSTALLER_NAME:-}"
INSTALLER_EMAIL="${INSTALLER_EMAIL:-}"
NOTIFY_UPDATES="${NOTIFY_UPDATES}"
MC_PANEL_REGISTRY_URL="${MC_PANEL_REGISTRY_URL}"
CONF
chmod 600 "${INSTALLER_CONF_DIR}/installer.conf"
success "Installer config saved: ${INSTALLER_CONF_DIR}/installer.conf"

# Register installation — thank-you email + update opt-in
if [[ -n "${INSTALLER_EMAIL:-}" ]]; then
  REGISTER_PAYLOAD="{\"email\":\"${INSTALLER_EMAIL}\",\"name\":\"${INSTALLER_NAME:-}\",\"serverIp\":\"${SERVER_IP}\",\"panelDomain\":\"${PANEL_DOMAIN}\",\"panelVersion\":\"1.0.0\",\"notifyUpdates\":${NOTIFY_UPDATES}}"
  if curl -sf --max-time 10 -X POST "${MC_PANEL_REGISTRY_URL}" \
      -H "Content-Type: application/json" \
      -d "${REGISTER_PAYLOAD}" >/dev/null 2>&1; then
    info "Registration sent — thank-you email queued"
  else
    info "Could not reach registry (non-fatal) — install continues"
  fi
fi

# ── Final health check ────────────────────────────────────────────────
step "Final health check"
sleep 2
if curl -sf --max-time 5 http://127.0.0.1:3001/health >/dev/null 2>&1; then
  success "API health: OK"
else
  warn "API health check failed — check: journalctl -u mc-panel -n 50"
fi
if curl -sf --max-time 5 http://127.0.0.1:80 >/dev/null 2>&1; then
  success "Nginx: OK"
else
  warn "Nginx not responding — check: nginx -t && systemctl status nginx"
fi

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║          Installation Complete!                   ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Panel URL:${NC}      ${SCHEME}://${PANEL_DOMAIN}"
echo -e "  ${BOLD}Admin email:${NC}    ${ADMIN_EMAIL}"
echo -e "  ${BOLD}Admin password:${NC} (the one you entered)"
echo -e "  ${BOLD}Install log:${NC}    ${LOGFILE}"
echo ""
if [[ "$SSL_OK" != "true" ]]; then
  echo -e "  ${YELLOW}${BOLD}SSL not active.${NC} Once DNS is configured, enable HTTPS:"
  echo -e "  ${CYAN}certbot --nginx -d <your-domain> --email ${ADMIN_EMAIL} --agree-tos --redirect${NC}"
  echo -e "  Then update CORS_ORIGIN in ${PANEL_DIR}/apps/api/.env and restart mc-panel."
  echo ""
fi
echo -e "  ${BOLD}Service commands:${NC}"
echo "    systemctl status  mc-panel"
echo "    systemctl restart mc-panel"
echo "    journalctl -u mc-panel -f"
echo ""
echo -e "  ${BOLD}Management:${NC}"
echo -e "  Update panel:    ${CYAN}bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-panel.sh)${NC}"
echo -e "  Uninstall panel: ${CYAN}bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/uninstall-panel.sh)${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo "  1. Open ${SCHEME}://${PANEL_DOMAIN} and sign in"
echo "  2. Admin → Nodes → New Node (add a game server)"
echo "  3. On each game server run:"
echo ""
echo -e "  ${CYAN}bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-wings.sh)${NC}"
echo ""
echo "──── Install finished: $(date) ────"
