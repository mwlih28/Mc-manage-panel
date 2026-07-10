#!/usr/bin/env bash
# Kretase — Wings Daemon Updater
# Updates Wings code, rebuilds, restarts. Config (config.yml) is untouched.
#
# Usage:
#   bash <(curl -fsSL https://get.kretase.com/update-wings)
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
# Build ONLY the Wings workspace. The repo-root `build` script compiles
# apps/api + apps/web (needed on the panel host, not here) — running it on a
# Wings-only node pointlessly tries to typecheck the API against a Prisma
# client that was never generated on this box and fails the whole update.
# Wings has no dependency on apps/api, so its own tsc build is self-contained.
npm run build --workspace=apps/wings
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

# ── Firewall ──────────────────────────────────────────────────────────
# Nodes installed before this update only opened the Minecraft port range —
# `ufw allow` is idempotent, so it's safe to re-apply on every update as new
# game ports get added here, without needing a separate one-off script.
step "Refreshing firewall rules (UFW)"
if command -v ufw &>/dev/null; then
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
  success "UFW: common non-Minecraft game ports opened"
else
  info "UFW not found — skipping firewall refresh"
fi

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
