#!/usr/bin/env bash
# Kretase — Panel Updater
# Updates code, rebuilds, restarts — does NOT touch database data or .env
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-panel.sh)

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${CYAN}•${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
error()   { echo -e "\n  ${RED}✖ ERROR:${NC} $*\n" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}┌─ $* ${NC}"; }

PANEL_DIR="/var/www/mc-panel"
PANEL_USER="mcpanel"
BRANCH="main"
LOGFILE="/var/log/mc-panel-update.log"

# ── Lock file ─────────────────────────────────────────────────────────
LOCKFILE="/tmp/mc-panel-update.lock"
if [[ -f "$LOCKFILE" ]]; then
  error "Another update is in progress. Remove lock if stuck: rm -f $LOCKFILE"
fi
touch "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT INT TERM

mkdir -p /var/log
exec > >(tee -a "$LOGFILE") 2>&1
echo "──── Update started: $(date) ────"

echo -e "\n${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║             Kretase — Updater                     ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"
[[ -d "${PANEL_DIR}/.git" ]] || error "Panel not found at ${PANEL_DIR}. Run the installer first."
[[ -f "${PANEL_DIR}/apps/api/.env" ]] || error ".env not found — panel may not be properly installed."

PRISMA_BIN="${PANEL_DIR}/node_modules/.bin/prisma"

# ── Check current version ──────────────────────────────────────────────
CURRENT_COMMIT=$(git -C "$PANEL_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
info "Current commit: ${CURRENT_COMMIT}"

# ── Pull latest code ───────────────────────────────────────────────────
step "Pulling latest code"
git config --global --add safe.directory "$PANEL_DIR" 2>/dev/null || true
git -C "$PANEL_DIR" fetch origin "${BRANCH}" --quiet
NEW_COMMIT=$(git -C "$PANEL_DIR" rev-parse --short "origin/${BRANCH}" 2>/dev/null || echo "unknown")

if [[ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]]; then
  info "Already on the latest version (${CURRENT_COMMIT}). Nothing to do."
  echo "──── Update finished: $(date) ────"
  exit 0
fi

info "Updating: ${CURRENT_COMMIT} → ${NEW_COMMIT}"
git -C "$PANEL_DIR" reset --hard FETCH_HEAD --quiet
success "Code updated"

# ── Backup database before schema changes ─────────────────────────────
step "Backing up database"
PG() { cd /tmp && sudo -u postgres "$@"; cd - >/dev/null; }
BACKUP_FILE="/tmp/mc-panel-db-$(date +%Y%m%d%H%M%S).sql"
PG pg_dump mcpanel > "$BACKUP_FILE" 2>/dev/null && \
  success "Database backed up: ${BACKUP_FILE}" || \
  warn "Database backup failed — continuing anyway"

# ── Install / update dependencies ─────────────────────────────────────
step "Updating dependencies"
cd "${PANEL_DIR}"
rm -f package-lock.json apps/api/package-lock.json apps/web/package-lock.json
NPM_OK=false
for attempt in 1 2 3; do
  if npm install --no-fund --no-audit; then NPM_OK=true; break; fi
  warn "npm install failed (attempt ${attempt}/3). Retrying in 10s..."
  sleep 10
done
$NPM_OK || error "npm install failed after 3 attempts."
[[ -x "$PRISMA_BIN" ]] || error "Prisma binary not found."
success "Dependencies updated"

# ── Build API ─────────────────────────────────────────────────────────
step "Building API"
cd "${PANEL_DIR}/apps/api"
"$PRISMA_BIN" generate
PATH="${PANEL_DIR}/node_modules/.bin:$PATH" npm run build
success "API built"

# ── Build Web ─────────────────────────────────────────────────────────
step "Building Web"
cd "${PANEL_DIR}/apps/web"
PATH="${PANEL_DIR}/node_modules/.bin:$PATH" npm run build
success "Web built"

# ── Apply schema changes (data-safe) ──────────────────────────────────
step "Applying schema changes"
cd "${PANEL_DIR}/apps/api"
"$PRISMA_BIN" db push --accept-data-loss
success "Schema up to date"

# ── Fix permissions & restart ─────────────────────────────────────────
step "Restarting service"
chown -R "${PANEL_USER}:${PANEL_USER}" "$PANEL_DIR"
chmod 750 "${PANEL_DIR}/apps/api/dist"
systemctl restart mc-panel

# Wait for API (up to 20s)
API_READY=false
for i in {1..20}; do
  if curl -sf --max-time 2 http://127.0.0.1:3001/health >/dev/null 2>&1; then
    API_READY=true; break
  fi
  sleep 1
done
$API_READY && success "API is up" || warn "API health check failed — check: journalctl -u mc-panel -n 50"

# ── Send update notification (if opt-in stored) ───────────────────────
INSTALLER_CONF="/etc/mc-panel/installer.conf"
if [[ -f "$INSTALLER_CONF" ]]; then
  . "$INSTALLER_CONF"
  REGISTRY_URL="${MC_PANEL_REGISTRY_URL:-https://mcpanel.app.n8n.cloud/webhook/mc-panel-register}"
  if [[ -n "${INSTALLER_EMAIL:-}" ]]; then
    UPDATE_PAYLOAD="{\"email\":\"${INSTALLER_EMAIL}\",\"name\":\"${INSTALLER_NAME:-}\",\"serverIp\":\"$(hostname -I | awk '{print $1}')\",\"panelDomain\":\"${PANEL_DOMAIN_ORIGINAL:-}\",\"panelVersion\":\"${NEW_COMMIT}\",\"notifyUpdates\":${NOTIFY_UPDATES:-false}}"
    curl -sf --max-time 10 -X POST "${REGISTRY_URL}" \
      -H "Content-Type: application/json" \
      -d "${UPDATE_PAYLOAD}" >/dev/null 2>&1 && info "Registration updated" || true
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║          Update Complete!                         ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Updated:${NC}   ${CURRENT_COMMIT} → ${NEW_COMMIT}"
echo -e "  ${BOLD}DB backup:${NC} ${BACKUP_FILE}"
echo -e "  ${BOLD}Log:${NC}       ${LOGFILE}"
echo ""
echo -e "  ${BOLD}Service:${NC}   systemctl status mc-panel"
echo ""
echo "──── Update finished: $(date) ────"
