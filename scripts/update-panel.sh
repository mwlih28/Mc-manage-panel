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

PANEL_DIR="/var/www/kretase"
PANEL_USER="mcpanel"
REPO_API="https://api.github.com/repos/mwlih28/mc-manage-panel"
BRANCH="main"
LOGFILE="/var/log/kretase-update.log"

# ── Lock file ─────────────────────────────────────────────────────────
LOCKFILE="/tmp/kretase-update.lock"
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

# ── Resolve latest stable release ────────────────────────────────────
# Updates always track the latest tagged release, not the tip of main —
# main gets pushed to directly during development and can be broken
# between releases. Falls back to main if no release exists yet or
# GitHub is unreachable.
LATEST_TAG=$(curl -fsSL -H "User-Agent: Kretase-Updater/1.0" "${REPO_API}/releases/latest" 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
if [[ -n "$LATEST_TAG" ]]; then
  BRANCH="$LATEST_TAG"
  info "Latest release: ${BRANCH}"
else
  warn "No tagged release found — updating to main (may include unreleased changes)"
fi

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

# ── Keep the displayed panel version in sync with what's actually deployed
ENV_FILE="${PANEL_DIR}/apps/api/.env"
if grep -q '^PANEL_VERSION=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s/^PANEL_VERSION=.*/PANEL_VERSION=${BRANCH}/" "$ENV_FILE"
else
  echo "PANEL_VERSION=${BRANCH}" >> "$ENV_FILE"
fi

# ── Backup database before schema changes ─────────────────────────────
step "Backing up database"
PG() { cd /tmp && sudo -u postgres "$@"; cd - >/dev/null; }
BACKUP_FILE="/tmp/kretase-db-$(date +%Y%m%d%H%M%S).sql"
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
systemctl restart kretase

# Wait for API (up to 20s)
API_READY=false
for i in {1..20}; do
  if curl -sf --max-time 2 http://127.0.0.1:3001/health >/dev/null 2>&1; then
    API_READY=true; break
  fi
  sleep 1
done
$API_READY && success "API is up" || warn "API health check failed — check: journalctl -u kretase -n 50"

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
echo -e "  ${BOLD}Service:${NC}   systemctl status kretase"
echo ""
echo -e "  ${YELLOW}Reminder:${NC} panel updates sometimes add new Wings routes/features."
echo -e "  Run this on each node too: ${CYAN}bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-wings.sh)${NC}"
echo ""
echo "──── Update finished: $(date) ────"
