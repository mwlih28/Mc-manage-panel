#!/usr/bin/env bash
# Kretase — Wings Daemon Installer
# Supported: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12
#
# One-liner install:
#   bash <(curl -fsSL https://get.kretase.com/wings)
#
# Run this on each GAME SERVER (node) — NOT on your panel server.

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
WINGS_DIR="/opt/mc-wings"
WINGS_USER="mcwings"
CONFIG_DIR="/etc/mc-wings"
DATA_DIR="/var/lib/mc-wings"
LOG_DIR="/var/log/mc-wings"
NODE_VERSION="20"
REPO_URL="https://github.com/mwlih28/mc-manage-panel"
REPO_API="https://api.github.com/repos/mwlih28/mc-manage-panel"
BRANCH="main"
MIN_DISK_GB=10
MIN_RAM_MB=512

# ── Resolve latest stable release ────────────────────────────────────
# Same reasoning as install-panel.sh — track releases, not main's tip.
LATEST_TAG=$(curl -fsSL -H "User-Agent: Kretase-Installer/1.0" "${REPO_API}/releases/latest" 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
[[ -n "$LATEST_TAG" ]] && BRANCH="$LATEST_TAG"

# ── Auto-activation (paste-and-go, like Pterodactyl's node deploy) ─────
# Admin → Nodes → your node shows a one-liner with these baked in:
#   bash <(curl -fsSL .../install-wings.sh) --panel=https://panel.example.com --code=XXXX
# Skips every prompt below by fetching the node's real config from the
# panel instead of asking the admin to copy each field by hand.
AUTO_PANEL=""
AUTO_CODE=""
for arg in "$@"; do
  case "$arg" in
    --panel=*) AUTO_PANEL="${arg#--panel=}" ;;
    --code=*)  AUTO_CODE="${arg#--code=}" ;;
  esac
done

# ── Lock file ─────────────────────────────────────────────────────────
LOCKFILE="/tmp/mc-wings-install.lock"
if [[ -f "$LOCKFILE" ]]; then
  error "Another install may be in progress.\n  If it crashed, remove the lock: rm -f $LOCKFILE"
fi
touch "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT INT TERM

# ── Install log ───────────────────────────────────────────────────────
LOGFILE="/var/log/mc-wings-install.log"
mkdir -p /var/log
exec > >(tee -a "$LOGFILE") 2>&1
echo "──── Wings install started: $(date) ────"

# ── Banner ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║          Kretase — Wings Installer v1.0           ║"
echo "  ║          Game Server Node Daemon                  ║"
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

# ── Disk & RAM pre-flight ─────────────────────────────────────────────
AVAIL_DISK_GB=$(df -BG / | awk 'NR==2{gsub(/G/,"",$4); print $4}')
[[ "${AVAIL_DISK_GB:-0}" -lt "$MIN_DISK_GB" ]] && \
  error "Not enough disk space: ${AVAIL_DISK_GB}GB available, ${MIN_DISK_GB}GB required (game servers need room)."
info "Disk: ${AVAIL_DISK_GB}GB available"

AVAIL_RAM_MB=$(awk '/MemAvailable/{ printf "%d", $2/1024 }' /proc/meminfo)
[[ "${AVAIL_RAM_MB:-0}" -lt "$MIN_RAM_MB" ]] && \
  warn "Low RAM: ${AVAIL_RAM_MB}MB available. Game servers typically need 512MB+ each."
info "RAM: ${AVAIL_RAM_MB}MB available"

# ── Collect inputs ────────────────────────────────────────────────────
step "Configuration"

if [[ -n "$AUTO_PANEL" && -n "$AUTO_CODE" ]]; then
  info "Auto-activating using the code from the panel..."
  PANEL_URL="${AUTO_PANEL%/}"
  SETUP_JSON=$(curl -fsSL --max-time 15 "${PANEL_URL}/api/v1/nodes/setup/${AUTO_CODE}") \
    || error "Could not reach ${PANEL_URL} — check the URL and your network, then try again."

  NODE_TOKEN=$(echo "$SETUP_JSON" | grep -o '"nodeToken":"[^"]*"' | cut -d'"' -f4)
  NODE_FQDN=$(echo "$SETUP_JSON" | grep -o '"fqdn":"[^"]*"' | cut -d'"' -f4)
  WINGS_PORT=$(echo "$SETUP_JSON" | grep -o '"daemonPort":[0-9]*' | grep -o '[0-9]*$')
  NODE_SCHEME=$(echo "$SETUP_JSON" | grep -o '"scheme":"[^"]*"' | cut -d'"' -f4)
  [[ -z "$NODE_TOKEN" || -z "$NODE_FQDN" || -z "$WINGS_PORT" ]] && \
    error "Activation code invalid or expired. Generate a new one from Admin → Nodes → your node."
  WINGS_SSL="n"; [[ "$NODE_SCHEME" == "https" ]] && WINGS_SSL="y"

  success "Activated as node: ${NODE_FQDN}"
else
  echo ""
  echo -e "  ${BOLD}Where to find the token:${NC}"
  echo "    1. Open your panel → Admin → Nodes → your node"
  echo "    2. Click the Configuration tab → copy the Token"
  echo "       (or copy the one-liner install command shown there instead"
  echo "       of typing these in by hand)"
  echo ""

  read -rp "  Panel URL (e.g. https://panel.yourdomain.com): " PANEL_URL
  [[ -z "$PANEL_URL" ]] && error "Panel URL is required."
  PANEL_URL="${PANEL_URL%/}"  # strip trailing slash

  read -rp "  Node token (from Admin → Nodes → your node): " NODE_TOKEN
  [[ -z "$NODE_TOKEN" ]] && error "Node token is required."
  [[ ${#NODE_TOKEN} -lt 16 ]] && error "Node token looks too short. Copy the full token from the panel."

  read -rp "  This server's FQDN or public IP: " NODE_FQDN
  [[ -z "$NODE_FQDN" ]] && error "FQDN/IP is required."

  read -rp "  Wings listen port [8080]: " WINGS_PORT
  WINGS_PORT="${WINGS_PORT:-8080}"

  # Validate port is numeric
  [[ "$WINGS_PORT" =~ ^[0-9]+$ ]] || error "Port must be a number."
  [[ "$WINGS_PORT" -ge 1 && "$WINGS_PORT" -le 65535 ]] || error "Port must be between 1 and 65535."

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
fi

# ── Verify panel is reachable before spending time installing ─────────
info "Verifying panel connectivity..."
if curl -sf --max-time 10 "${PANEL_URL}/health" >/dev/null 2>&1; then
  success "Panel reachable at ${PANEL_URL}"
else
  warn "Cannot reach panel at ${PANEL_URL}/health"
  read -rp "  Continue anyway? [y/N]: " FORCE_CONTINUE
  [[ "${FORCE_CONTINUE,,}" == "y" ]] || { echo "Aborted. Fix panel connectivity first."; exit 1; }
fi

# ── System packages ───────────────────────────────────────────────────
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q \
  curl wget git openssl \
  software-properties-common apt-transport-https \
  ca-certificates gnupg lsb-release
success "System packages installed"

# ── Docker ────────────────────────────────────────────────────────────
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

# ── Wings user ────────────────────────────────────────────────────────
step "Setting up Wings user"
if ! id -u "$WINGS_USER" &>/dev/null; then
  useradd -r -m -d "$WINGS_DIR" -s /usr/sbin/nologin "$WINGS_USER"
fi
usermod -aG docker "$WINGS_USER"
success "User '${WINGS_USER}' in docker group"

# ── Directories ───────────────────────────────────────────────────────
step "Creating directories"
mkdir -p "$WINGS_DIR" "$CONFIG_DIR" "$DATA_DIR/volumes" "$DATA_DIR/tmp" "$LOG_DIR"
chown -R "${WINGS_USER}:${WINGS_USER}" "$WINGS_DIR" "$DATA_DIR" "$LOG_DIR"
chown root:"${WINGS_USER}" "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"
success "Directories created"

# ── Clone / update source ─────────────────────────────────────────────
step "Fetching Wings source"
if [[ "$BRANCH" == "main" ]]; then
  warn "No tagged release found — installing from main (may include unreleased changes)"
else
  info "Installing release ${BRANCH}"
fi
git config --global --add safe.directory "$WINGS_DIR" 2>/dev/null || true
if [[ -d "${WINGS_DIR}/.git" ]]; then
  info "Updating existing installation..."
  git -C "$WINGS_DIR" fetch origin "${BRANCH}" --quiet
  git -C "$WINGS_DIR" reset --hard FETCH_HEAD --quiet
elif [[ -d "${WINGS_DIR}" ]]; then
  info "Removing incomplete directory and re-cloning..."
  rm -rf "$WINGS_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WINGS_DIR" --quiet
else
  info "Cloning from ${REPO_URL}..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WINGS_DIR" --quiet
fi
success "Source at ${WINGS_DIR}"

# ── Build Wings (with npm retry) ──────────────────────────────────────
step "Installing and building Wings"
cd "${WINGS_DIR}/apps/wings"
NPM_OK=false
for attempt in 1 2 3; do
  if npm install --no-fund --no-audit --quiet; then NPM_OK=true; break; fi
  warn "npm install failed (attempt ${attempt}/3). Retrying in 10s..."
  sleep 10
done
$NPM_OK || error "npm install failed after 3 attempts."
npm run build
success "Wings built → ${WINGS_DIR}/apps/wings/dist"
chown -R "${WINGS_USER}:${WINGS_USER}" "$WINGS_DIR"

# ── SSL certificate (optional) ────────────────────────────────────────
SSL_ENABLED="false"
SSL_CERT=""
SSL_KEY=""
SCHEME="http"

if [[ "${WINGS_SSL,,}" == "y" ]]; then
  step "Setting up SSL for Wings"
  apt-get install -y certbot >/dev/null

  CERTBOT_METHOD="--standalone"
  if systemctl is-active --quiet nginx 2>/dev/null; then
    warn "Nginx is running on this server — using nginx plugin for certbot."
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
    # Auto-renewal hook
    mkdir -p /etc/letsencrypt/renewal-hooks/deploy
    cat > "/etc/letsencrypt/renewal-hooks/deploy/restart-mc-wings.sh" <<'HOOK'
#!/bin/sh
systemctl restart mc-wings
HOOK
    chmod +x "/etc/letsencrypt/renewal-hooks/deploy/restart-mc-wings.sh"
    success "Certbot auto-renewal hook installed"
  else
    warn "Certbot failed — Wings will run without SSL (HTTP mode)."
    warn "Make sure ${NODE_FQDN} resolves to this server's IP."
  fi
fi

# ── Write config.yml ──────────────────────────────────────────────────
step "Writing Wings configuration"
cat > "${CONFIG_DIR}/config.yml" <<YAML
# Kretase — Wings Configuration
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

# ── Systemd service ───────────────────────────────────────────────────
step "Creating systemd service"
NODE_BIN="$(which node)"
cat > /etc/systemd/system/mc-wings.service <<SERVICE
[Unit]
Description=Kretase Wings Daemon
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

# Wait for Wings to start (up to 20s)
info "Waiting for Wings to start..."
WINGS_READY=false
for i in {1..20}; do
  if curl -sf --max-time 2 "http://127.0.0.1:${WINGS_PORT}/api/system" >/dev/null 2>&1; then
    WINGS_READY=true; break
  fi
  sleep 1
done
if $WINGS_READY; then
  success "Wings is up and responding"
elif systemctl is-active --quiet mc-wings; then
  success "mc-wings service running (health endpoint not checked)"
else
  warn "mc-wings failed to start. Check: journalctl -u mc-wings -n 50"
fi

# ── Firewall ──────────────────────────────────────────────────────────
step "Configuring firewall (UFW)"
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp                  comment "SSH"          >/dev/null 2>&1 || true
  ufw allow "${WINGS_PORT}/tcp"     comment "Wings daemon" >/dev/null 2>&1 || true
  ufw allow 2022/tcp                comment "Wings SFTP"   >/dev/null 2>&1 || true
  ufw allow 25565:25600/tcp         comment "Minecraft"    >/dev/null 2>&1 || true
  ufw allow 25565:25600/udp         comment "Minecraft"    >/dev/null 2>&1 || true
  # Common non-Minecraft game ports (community egg store) — best-effort
  # coverage, not exhaustive. Ranges give room for more than one server of
  # the same game on this node; open more manually if you need it.
  for range in \
    "27015:27050:Source engine (CS2/GMod/TF2/L4D2)" \
    "28015:28050:Rust" \
    "7777:7800:ARK/Terraria/Satisfactory" \
    "2456:2470:Valheim" \
    "26900:26910:7 Days to Die" \
    "16261:16270:Project Zomboid" \
    "9876:9880:V Rising" \
    "8211:8220:Palworld" \
    "7787:7790:Squad" \
    "34197:34200:Factorio" \
    "9987:9990:TeamSpeak" \
    "64738:64740:Mumble"
  do
    portRange="${range%:*}"; game="${range##*:}"
    ufw allow "${portRange}/tcp" comment "$game" >/dev/null 2>&1 || true
    ufw allow "${portRange}/udp" comment "$game" >/dev/null 2>&1 || true
  done
  ufw --force enable >/dev/null 2>&1 || true
  success "UFW: ports 22, ${WINGS_PORT}, 2022, 25565-25600 (+ common game ranges) open"
else
  info "UFW not found — skipping firewall"
fi

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║        Wings Installation Complete!               ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Daemon URL:${NC}    ${SCHEME}://${NODE_FQDN}:${WINGS_PORT}"
echo -e "  ${BOLD}Config:${NC}        ${CONFIG_DIR}/config.yml"
echo -e "  ${BOLD}Data:${NC}          ${DATA_DIR}/volumes/"
echo -e "  ${BOLD}Install log:${NC}   ${LOGFILE}"
echo ""
echo -e "  ${BOLD}Service commands:${NC}"
echo "    systemctl status  mc-wings"
echo "    systemctl restart mc-wings"
echo "    journalctl -u mc-wings -f"
echo ""
echo -e "  ${BOLD}Update Wings later:${NC}"
echo -e "  ${CYAN}bash <(curl -fsSL https://get.kretase.com/update-wings)${NC}"
echo ""
echo -e "  ${BOLD}Next steps in your panel:${NC}"
echo "  1. Go to Admin → Nodes → your node → Edit"
echo "  2. Set FQDN  : ${NODE_FQDN}"
echo "  3. Set Port  : ${WINGS_PORT}"
echo "  4. Set Scheme: ${SCHEME}"
echo "  5. Save — node status should turn green"
echo "  6. Add Allocations (IPs + ports for game servers)"
echo "  7. Create your first server in Admin → Servers → New Server"
echo ""
echo "──── Wings install finished: $(date) ────"
