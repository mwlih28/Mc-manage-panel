#!/usr/bin/env bash
# Kretase — Wings Daemon Updater
# Updates Wings code, rebuilds, restarts. Config (config.yml) is untouched.
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-wings.sh)
#
# Run this on each GAME SERVER (node) running Wings.

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${CYAN}•${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
error()   { echo -e "\n  ${RED}✖ ERROR:${NC} $*\n" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}┌─ $* ${NC}"; }

WINGS_DIR="/opt/mc-wings"
WINGS_USER="mcwings"
BRANCH="main"
LOGFILE="/var/log/mc-wings-update.log"

# ── Lock file ─────────────────────────────────────────────────────────
LOCKFILE="/tmp/mc-wings-update.lock"
if [[ -f "$LOCKFILE" ]]; then
  error "Another update is in progress. Remove lock if stuck: rm -f $LOCKFILE"
fi
touch "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT INT TERM

mkdir -p /var/log
exec > >(tee -a "$LOGFILE") 2>&1
echo "──── Wings update started: $(date) ────"

echo -e "\n${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║          Kretase — Wings Updater                  ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"
[[ -d "${WINGS_DIR}/.git" ]] || error "Wings not found at ${WINGS_DIR} (or not a git checkout). Run install-wings.sh first."

# ── Check current version ──────────────────────────────────────────────
CURRENT_COMMIT=$(git -C "$WINGS_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
info "Current commit: ${CURRENT_COMMIT}"

# ── Pull latest code ───────────────────────────────────────────────────
step "Pulling latest code"
git config --global --add safe.directory "$WINGS_DIR" 2>/dev/null || true
git -C "$WINGS_DIR" fetch origin "${BRANCH}" --quiet
NEW_COMMIT=$(git -C "$WINGS_DIR" rev-parse --short "origin/${BRANCH}" 2>/dev/null || echo "unknown")

if [[ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]]; then
  info "Already on the latest version (${CURRENT_COMMIT}). Nothing to do."
  echo "──── Wings update finished: $(date) ────"
  exit 0
fi

info "Updating: ${CURRENT_COMMIT} → ${NEW_COMMIT}"
git -C "$WINGS_DIR" reset --hard FETCH_HEAD --quiet
success "Code updated"

# ── Install / update dependencies + rebuild ────────────────────────────
step "Installing dependencies and building"
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

# ── Fix permissions & restart ──────────────────────────────────────────
step "Restarting service"
chown -R "${WINGS_USER}:${WINGS_USER}" "$WINGS_DIR"
systemctl restart mc-wings

# Wait for Wings to come back (up to 20s)
WINGS_READY=false
for i in {1..20}; do
  if systemctl is-active --quiet mc-wings; then WINGS_READY=true; break; fi
  sleep 1
done
$WINGS_READY && success "mc-wings is running" || warn "mc-wings did not report active — check: journalctl -u mc-wings -n 50"

echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║        Wings Update Complete!                     ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Updated:${NC} ${CURRENT_COMMIT} → ${NEW_COMMIT}"
echo -e "  ${BOLD}Log:${NC}     ${LOGFILE}"
echo ""
echo -e "  ${BOLD}Service:${NC} systemctl status mc-wings"
echo ""
echo "──── Wings update finished: $(date) ────"
