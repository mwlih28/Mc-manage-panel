#!/usr/bin/env bash
# MC Manage Panel - Wings Daemon Installation Script
# Supports: Ubuntu 20.04/22.04/24.04, Debian 11/12
# Usage: bash <(curl -s https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-wings.sh)

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

WINGS_DIR="/opt/mc-wings"
WINGS_USER="mcwings"
CONFIG_DIR="/etc/mc-wings"
DATA_DIR="/var/lib/mc-wings"
NODE_VERSION="20"
REPO="https://github.com/mwlih28/mc-manage-panel"

# ─────────── Banner ───────────
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║       MC Manage Panel — Wings Installer v1.0         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─────────── Root check ───────────
[[ $EUID -ne 0 ]] && error "This script must be run as root. Try: sudo bash install-wings.sh"

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

read -rp "$(echo -e "${CYAN}Panel URL (e.g. https://panel.yourdomain.com):${NC} ")" PANEL_URL
[[ -z "$PANEL_URL" ]] && error "Panel URL is required"
# Strip trailing slash
PANEL_URL="${PANEL_URL%/}"

read -rp "$(echo -e "${CYAN}Node token (from Panel Admin → Nodes → your node → Configuration):${NC} ")" NODE_TOKEN
[[ -z "$NODE_TOKEN" ]] && error "Node token is required"

read -rp "$(echo -e "${CYAN}Wings listen port [8080]:${NC} ")" WINGS_PORT
WINGS_PORT="${WINGS_PORT:-8080}"

read -rp "$(echo -e "${CYAN}Wings use HTTPS? [y/N]:${NC} ")" WINGS_SSL
WINGS_SSL="${WINGS_SSL:-n}"

read -rp "$(echo -e "${CYAN}Node FQDN / IP (this server's public address):${NC} ")" NODE_FQDN
[[ -z "$NODE_FQDN" ]] && error "Node FQDN/IP is required"

echo ""
info "Panel URL:   $PANEL_URL"
info "Wings Port:  $WINGS_PORT"
info "Node FQDN:   $NODE_FQDN"
info "Wings HTTPS: $WINGS_SSL"
echo ""
read -rp "$(echo -e "${YELLOW}Continue? [Y/n]:${NC} ")" CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && exit 0

# ─────────── System update ───────────
step "Updating system packages"
apt-get update -qq
apt-get install -y -qq curl wget git unzip tar \
  software-properties-common apt-transport-https \
  ca-certificates gnupg lsb-release openssl

# ─────────── Docker ───────────
step "Installing Docker"
if ! command -v docker &>/dev/null; then
  info "Adding Docker repository..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/${OS_NAME}/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_NAME} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  info "Docker already installed: $(docker --version)"
fi

systemctl enable docker --now
success "Docker ready: $(docker --version)"

# ─────────── Node.js ───────────
step "Installing Node.js ${NODE_VERSION}"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
success "Node.js installed: $(node --version)"

# ─────────── Create Wings user ───────────
step "Creating Wings user"
if ! id -u "$WINGS_USER" &>/dev/null; then
  useradd -r -d "$WINGS_DIR" -s /bin/bash "$WINGS_USER"
fi
# Allow Wings user to use Docker
usermod -aG docker "$WINGS_USER"
success "User $WINGS_USER configured"

# ─────────── Create directories ───────────
step "Creating directories"
mkdir -p "$WINGS_DIR" "$CONFIG_DIR" "$DATA_DIR" "$DATA_DIR/servers" "$DATA_DIR/volumes"
chown -R "$WINGS_USER:$WINGS_USER" "$WINGS_DIR" "$DATA_DIR"
chown root:root "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"
success "Directories created"

# ─────────── Clone/update Wings source ───────────
step "Installing Wings"
if [[ -d "$WINGS_DIR/.git" ]]; then
  info "Updating existing Wings installation..."
  git -C "$WINGS_DIR" pull origin main
else
  info "Cloning repository..."
  git clone "$REPO" "$WINGS_DIR"
fi

cd "$WINGS_DIR/apps/wings"

info "Installing Wings dependencies..."
npm install --quiet

info "Building Wings..."
npx tsc

success "Wings built successfully"

# ─────────── SSL certificate for Wings (optional) ───────────
if [[ "${WINGS_SSL,,}" == "y" ]]; then
  step "Generating SSL certificate for Wings"
  apt-get install -y certbot
  if certbot certonly --standalone -d "$NODE_FQDN" --non-interactive --agree-tos \
      -m "admin@${NODE_FQDN}" 2>/dev/null; then
    SSL_CERT="/etc/letsencrypt/live/${NODE_FQDN}/fullchain.pem"
    SSL_KEY="/etc/letsencrypt/live/${NODE_FQDN}/privkey.pem"
    success "SSL certificate obtained"
  else
    warn "SSL certificate failed, falling back to self-signed"
    WINGS_SSL="n"
  fi
fi

# Self-signed fallback or HTTP
if [[ "${WINGS_SSL,,}" != "y" ]]; then
  SSL_CERT=""
  SSL_KEY=""
fi

# ─────────── Write Wings config ───────────
step "Writing configuration"

if [[ "${WINGS_SSL,,}" == "y" ]]; then
  SCHEME="https"
  SSL_ENABLED="true"
  SSL_CERT_VAL="${SSL_CERT}"
  SSL_KEY_VAL="${SSL_KEY}"
else
  SCHEME="http"
  SSL_ENABLED="false"
  SSL_CERT_VAL=""
  SSL_KEY_VAL=""
fi

cat > "$CONFIG_DIR/config.yml" <<YAML
# MC Wings Configuration
# Generated by install-wings.sh

debug: false
uuid: ''
token: '${NODE_TOKEN}'
remote: '${PANEL_URL}'

api:
  host: '0.0.0.0'
  port: ${WINGS_PORT}
  ssl:
    enabled: ${SSL_ENABLED}
    cert: '${SSL_CERT_VAL}'
    key: '${SSL_KEY_VAL}'

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
YAML

chmod 600 "$CONFIG_DIR/config.yml"
chown root:root "$CONFIG_DIR/config.yml"
success "Config written to $CONFIG_DIR/config.yml"

# ─────────── Systemd service ───────────
step "Creating systemd service"
cat > /etc/systemd/system/mc-wings.service <<SERVICE
[Unit]
Description=MC Manage Panel Wings Daemon
After=docker.service network.target
Requires=docker.service

[Service]
Type=simple
User=${WINGS_USER}
Group=${WINGS_USER}
WorkingDirectory=${WINGS_DIR}/apps/wings
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StartLimitInterval=180
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mc-wings
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable mc-wings
systemctl start mc-wings
success "Wings service started"

# ─────────── Firewall ───────────
step "Configuring firewall"
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp    >/dev/null 2>&1 || true
  ufw allow "${WINGS_PORT}/tcp" >/dev/null 2>&1 || true
  ufw --force enable  >/dev/null 2>&1 || true
  success "UFW configured (ports 22, ${WINGS_PORT} open)"
fi

# ─────────── Verify connection ───────────
step "Verifying Wings startup"
sleep 3
if systemctl is-active --quiet mc-wings; then
  success "Wings daemon is running"
else
  warn "Wings daemon is not running. Check logs: journalctl -u mc-wings -n 50"
fi

# Try to ping panel
if curl -sf --max-time 5 "${PANEL_URL}/health" > /dev/null 2>&1; then
  success "Panel is reachable at ${PANEL_URL}"
else
  warn "Cannot reach panel at ${PANEL_URL} — check your panel URL and firewall"
fi

# ─────────── Done ───────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║         Wings Installation Complete!                 ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${BOLD}Daemon URL:${NC}    ${SCHEME}://${NODE_FQDN}:${WINGS_PORT}"
echo -e "${BOLD}Config:${NC}        ${CONFIG_DIR}/config.yml"
echo -e "${BOLD}Data:${NC}          ${DATA_DIR}/"
echo ""
echo -e "${BOLD}Service commands:${NC}"
echo "  systemctl status mc-wings"
echo "  systemctl restart mc-wings"
echo "  journalctl -u mc-wings -f"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. In your panel, go to Admin → Nodes → your node"
echo "  2. Set FQDN to:  ${NODE_FQDN}"
echo "  3. Set port to:  ${WINGS_PORT}"
echo "  4. Set scheme to: ${SCHEME}"
echo "  5. Click 'Test Connection' — it should turn green"
echo "  6. Create Allocations (IP:port pairs) for your game servers"
echo ""
