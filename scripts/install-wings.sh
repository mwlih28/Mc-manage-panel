#!/usr/bin/env bash
# MC Manage Panel — Wings Daemon Installer
# Supported: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12
#
# One-liner install:
#   bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-wings.sh)
#
# Run this on each GAME SERVER (node) — NOT on your panel server.

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
WINGS_DIR="/opt/mc-wings"
WINGS_USER="mcwings"
CONFIG_DIR="/etc/mc-wings"
DATA_DIR="/var/lib/mc-wings"
LOG_DIR="/var/log/mc-wings"
NODE_VERSION="20"
REPO_URL="https://github.com/mwlih28/mc-manage-panel"
BRANCH="claude/pterodactyl-panel-builder-8uy3tp"

# ────────────────────────────── Banner ──────────────────────────────
echo -e "\n${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║     MC Manage Panel — Wings Installer v1.0        ║"
echo "  ║          Game Server Node Daemon                  ║"
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
  *) error "Unsupported OS: $OS_ID. Use Ubuntu 20/22/24 or Debian 11/12." ;;
esac

info "OS: ${OS_ID} ${OS_VER}"

# ────────────────────────────── Collect inputs ──────────────────────────────
step "Configuration"

echo ""
echo -e "  ${BOLD}Where to find the token:${NC}"
echo "    1. Open your panel → Admin → Nodes → New Node"
echo "    2. Fill in the node details (FQDN = this server's IP or domain)"
echo "    3. After creating the node, copy the Token from the Configuration tab"
echo ""

read -rp "  Panel URL (e.g. https://panel.yourdomain.com): " PANEL_URL
[[ -z "$PANEL_URL" ]] && error "Panel URL is required."
PANEL_URL="${PANEL_URL%/}"  # strip trailing slash

read -rp "  Node token (from Admin → Nodes → your node): " NODE_TOKEN
[[ -z "$NODE_TOKEN" ]] && error "Node token is required."

read -rp "  This server's FQDN or public IP: " NODE_FQDN
[[ -z "$NODE_FQDN" ]] && error "FQDN/IP is required."

read -rp "  Wings listen port [8080]: " WINGS_PORT
WINGS_PORT="${WINGS_PORT:-8080}"

read -rp "  Enable HTTPS on Wings? Requires a domain for this node. [y/N]: " WINGS_SSL
WINGS_SSL="${WINGS_SSL:-n}"

echo ""
echo -e "  ${BOLD}Summary:${NC}"
echo "    Panel URL  : $PANEL_URL"
echo "    Node FQDN  : $NODE_FQDN"
echo "    Wings port : $WINGS_PORT"
echo "    HTTPS      : $WINGS_SSL"
echo ""
read -rp "  Proceed? [Y/n]: " CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && { echo "Aborted."; exit 0; }

# ────────────────────────────── System packages ──────────────────────────────
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q \
  curl wget git openssl \
  software-properties-common apt-transport-https \
  ca-certificates gnupg lsb-release
success "System packages installed"

# ────────────────────────────── Docker ──────────────────────────────
step "Installing Docker"
if command -v docker &>/dev/null; then
  info "Docker already installed: $(docker --version)"
else
  info "Adding Docker repository..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -q
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin >/dev/null
fi

systemctl enable docker --now
success "Docker ready: $(docker --version | cut -d' ' -f3 | tr -d ',')"

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

# ────────────────────────────── Wings user ──────────────────────────────
step "Setting up Wings user"
if ! id -u "$WINGS_USER" &>/dev/null; then
  useradd -r -m -d "$WINGS_DIR" -s /usr/sbin/nologin "$WINGS_USER"
fi
# Must be in docker group to access /var/run/docker.sock
usermod -aG docker "$WINGS_USER"
success "User '${WINGS_USER}' in docker group"

# ────────────────────────────── Directories ──────────────────────────────
step "Creating directories"
mkdir -p \
  "$WINGS_DIR" \
  "$CONFIG_DIR" \
  "$DATA_DIR/volumes" \
  "$DATA_DIR/tmp" \
  "$LOG_DIR"
chown -R "${WINGS_USER}:${WINGS_USER}" "$WINGS_DIR" "$DATA_DIR" "$LOG_DIR"
chown root:"${WINGS_USER}" "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"
success "Directories created"

# ────────────────────────────── Clone / update source ──────────────────────────────
step "Fetching Wings source"
git config --global --add safe.directory "$WINGS_DIR" 2>/dev/null || true
if [[ -d "${WINGS_DIR}/.git" ]]; then
  info "Updating existing installation..."
  git -C "$WINGS_DIR" fetch origin --quiet
  git -C "$WINGS_DIR" reset --hard "origin/${BRANCH}" --quiet
elif [[ -d "${WINGS_DIR}" ]]; then
  info "Removing incomplete directory and re-cloning..."
  rm -rf "$WINGS_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WINGS_DIR" --quiet
else
  info "Cloning from ${REPO_URL} ..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WINGS_DIR" --quiet
fi
success "Source at ${WINGS_DIR}"

# ────────────────────────────── Build Wings ──────────────────────────────
step "Installing and building Wings"
cd "${WINGS_DIR}/apps/wings"
info "npm install..."
npm install --no-fund --no-audit --quiet
info "Compiling TypeScript..."
npm run build
success "Wings built → ${WINGS_DIR}/apps/wings/dist"

# Set ownership after build
chown -R "${WINGS_USER}:${WINGS_USER}" "$WINGS_DIR"

# ────────────────────────────── SSL certificate (optional) ──────────────────────────────
SSL_ENABLED="false"
SSL_CERT=""
SSL_KEY=""
SCHEME="http"

if [[ "${WINGS_SSL,,}" == "y" ]]; then
  step "Setting up SSL for Wings"
  apt-get install -y certbot >/dev/null

  # Port 80 might be in use (e.g. panel on same server).
  # Prefer webroot if nginx is running, otherwise standalone.
  CERTBOT_METHOD="--standalone"
  if systemctl is-active --quiet nginx 2>/dev/null; then
    warn "Nginx is running on this server. Using nginx plugin for certbot."
    apt-get install -y python3-certbot-nginx >/dev/null
    CERTBOT_METHOD="--nginx"
  fi

  if certbot certonly $CERTBOT_METHOD \
      -d "$NODE_FQDN" \
      --non-interactive --agree-tos \
      --email "admin@${NODE_FQDN}" \
      --quiet 2>/dev/null; then
    SSL_CERT="/etc/letsencrypt/live/${NODE_FQDN}/fullchain.pem"
    SSL_KEY="/etc/letsencrypt/live/${NODE_FQDN}/privkey.pem"
    SSL_ENABLED="true"
    SCHEME="https"
    success "SSL certificate obtained for ${NODE_FQDN}"

    # Allow Wings user to read certs
    chmod 755 "/etc/letsencrypt/live" "/etc/letsencrypt/archive"
    chgrp -R "${WINGS_USER}" "/etc/letsencrypt/live/${NODE_FQDN}" \
                              "/etc/letsencrypt/archive/${NODE_FQDN}" 2>/dev/null || true
    chmod g+rx "/etc/letsencrypt/live/${NODE_FQDN}" \
               "/etc/letsencrypt/archive/${NODE_FQDN}" 2>/dev/null || true
    chmod g+r "${SSL_CERT}" "${SSL_KEY}" 2>/dev/null || true
  else
    warn "Certbot failed. Make sure ${NODE_FQDN} resolves to this server."
    warn "Wings will start without SSL (HTTP mode)."
  fi
fi

# ────────────────────────────── Write config.yml ──────────────────────────────
step "Writing Wings configuration"
cat > "${CONFIG_DIR}/config.yml" <<YAML
# MC Manage Panel — Wings Configuration
# Generated by install-wings.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

debug: false
uuid: ''
token: '${NODE_TOKEN}'
remote: '${PANEL_URL}'

api:
  host: '0.0.0.0'
  port: ${WINGS_PORT}
  ssl:
    enabled: ${SSL_ENABLED}
    cert: '${SSL_CERT}'
    key: '${SSL_KEY}'

system:
  data: '${DATA_DIR}/volumes'
  sftp_bind_port: 2022
  username: '${WINGS_USER}'
  timezone: 'UTC'

docker:
  socket: '/var/run/docker.sock'
  network: 'mc-wings'
  tmpfs_size: 100
  container_pid_limit: 512

throttles:
  kill_at_count: 60
  decay: 5
  bytes: 0
  check_interval_ms: 100
  lines: 2000

logging:
  path: '${LOG_DIR}'
  level: 'info'
YAML

chown "${WINGS_USER}:${WINGS_USER}" "${CONFIG_DIR}/config.yml"
chmod 600 "${CONFIG_DIR}/config.yml"
success "Config → ${CONFIG_DIR}/config.yml"

# ────────────────────────────── Systemd service ──────────────────────────────
step "Creating systemd service"
NODE_BIN="$(which node)"
cat > /etc/systemd/system/mc-wings.service <<SERVICE
[Unit]
Description=MC Manage Panel Wings Daemon
Documentation=https://github.com/mwlih28/mc-manage-panel
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
User=${WINGS_USER}
Group=${WINGS_USER}
WorkingDirectory=${WINGS_DIR}/apps/wings
ExecStart=${NODE_BIN} dist/index.js
Restart=on-failure
RestartSec=10
StartLimitInterval=180
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mc-wings
Environment=NODE_ENV=production
Environment=CONFIG_PATH=${CONFIG_DIR}/config.yml

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable mc-wings --quiet
systemctl restart mc-wings
sleep 3

if systemctl is-active --quiet mc-wings; then
  success "mc-wings service running"
else
  warn "mc-wings failed to start. Check: journalctl -u mc-wings -n 50"
fi

# ────────────────────────────── Firewall ──────────────────────────────
step "Configuring firewall (UFW)"
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp                  comment "SSH"          >/dev/null 2>&1 || true
  ufw allow "${WINGS_PORT}/tcp"     comment "Wings daemon" >/dev/null 2>&1 || true
  ufw allow 2022/tcp                comment "Wings SFTP"   >/dev/null 2>&1 || true
  # Game server ports
  ufw allow 25565:25600/tcp         comment "Game servers" >/dev/null 2>&1 || true
  ufw allow 25565:25600/udp         comment "Game servers" >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  success "UFW: ports 22, ${WINGS_PORT}, 2022, 25565-25600 open"
else
  info "UFW not found — skipping firewall config"
fi

# ────────────────────────────── Verify panel connection ──────────────────────────────
step "Testing panel connectivity"
if curl -sf --max-time 10 "${PANEL_URL}/health" >/dev/null 2>&1; then
  success "Panel reachable at ${PANEL_URL}"
else
  warn "Cannot reach panel at ${PANEL_URL}"
  warn "Check the panel URL and ensure port 443/80 is open on the panel server."
fi

# ────────────────────────────── Done ──────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║        Wings Installation Complete! 🎉            ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Daemon URL:${NC}    ${SCHEME}://${NODE_FQDN}:${WINGS_PORT}"
echo -e "  ${BOLD}Config:${NC}        ${CONFIG_DIR}/config.yml"
echo -e "  ${BOLD}Data:${NC}          ${DATA_DIR}/volumes/"
echo -e "  ${BOLD}Logs:${NC}          journalctl -u mc-wings -f"
echo ""
echo -e "  ${BOLD}Service commands:${NC}"
echo "    systemctl status  mc-wings"
echo "    systemctl restart mc-wings"
echo "    journalctl -u mc-wings -f"
echo ""
echo -e "  ${BOLD}Next steps in your panel:${NC}"
echo "    1. Go to Admin → Nodes → your node → Edit"
echo "    2. Set FQDN  : ${NODE_FQDN}"
echo "    3. Set Port  : ${WINGS_PORT}"
echo "    4. Set Scheme: ${SCHEME}"
echo "    5. Save, then test the connection (it should turn green)"
echo "    6. Add Allocations (IPs + ports for game servers)"
echo "    7. Create your first server in Admin → Servers → New Server"
echo ""
