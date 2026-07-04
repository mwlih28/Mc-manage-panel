#!/usr/bin/env bash
# Kretase — Uninstaller
# Removes the panel cleanly. Optionally keeps or drops the database.
#
# Usage:
#   bash <(curl -fsSL https://get.kretase.com/uninstall-panel)

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${CYAN}•${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
error()   { echo -e "\n  ${RED}✖ ERROR:${NC} $*\n" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}┌─ $* ${NC}"; }

PANEL_DIR="${PANEL_DIR:-/var/www/kretase}"
PANEL_USER="${PANEL_USER:-mcpanel}"
PANEL_SERVICE="${PANEL_SERVICE:-kretase}"
DB_NAME="mcpanel"
DB_USER="mcpanel"

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"

# Installs from before the Kretase rebrand used /var/www/mc-panel and a
# "mc-panel" systemd service instead of today's defaults.
if [[ ! -d "${PANEL_DIR}/.git" && -d "/var/www/mc-panel/.git" ]]; then
  PANEL_DIR="/var/www/mc-panel"
  [[ "$PANEL_SERVICE" == "kretase" ]] && PANEL_SERVICE="mc-panel"
  info "Detected a pre-rebrand install — using ${PANEL_DIR} (service: ${PANEL_SERVICE})"
fi

echo -e "\n${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║            Kretase — Uninstaller                  ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "  ${RED}${BOLD}WARNING:${NC} This will remove Kretase from this server."
echo ""

read -rp "  Keep database (users, servers, settings)? [Y/n]: " KEEP_DB
KEEP_DB="${KEEP_DB:-y}"

read -rp "  Are you sure you want to uninstall? Type 'yes' to confirm: " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { echo "Aborted."; exit 0; }

# ── Stop & remove systemd service ────────────────────────────────────
step "Removing systemd service"
systemctl stop "$PANEL_SERVICE" 2>/dev/null || true
systemctl disable "$PANEL_SERVICE" 2>/dev/null || true
rm -f "/etc/systemd/system/${PANEL_SERVICE}.service"
systemctl daemon-reload
success "Service removed"

# ── Remove nginx config ───────────────────────────────────────────────
step "Removing Nginx config"
rm -f /etc/nginx/sites-enabled/kretase
rm -f /etc/nginx/sites-available/kretase
rm -f /etc/nginx/sites-available/kretase.bak
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
success "Nginx config removed"

# ── Remove panel files ────────────────────────────────────────────────
step "Removing panel files"
rm -rf "$PANEL_DIR"
success "Panel files removed from ${PANEL_DIR}"

# ── Remove installer config ───────────────────────────────────────────
rm -rf /etc/kretase
success "Installer config removed"

# ── Database ──────────────────────────────────────────────────────────
PG() { cd /tmp && sudo -u postgres "$@"; cd - >/dev/null; }

if [[ "${KEEP_DB,,}" == "n" ]]; then
  step "Dropping database"
  BACKUP_FILE="/tmp/kretase-db-final-$(date +%Y%m%d%H%M%S).sql"
  info "Creating final backup at ${BACKUP_FILE}..."
  PG pg_dump "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null || true
  PG psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null 2>&1 || true
  PG psql -c "DROP USER IF EXISTS ${DB_USER};" >/dev/null 2>&1 || true
  success "Database dropped (backup: ${BACKUP_FILE})"
else
  info "Database '${DB_NAME}' kept — reconnect with a fresh install if needed."
fi

# ── Remove service user (optional) ────────────────────────────────────
if id -u "$PANEL_USER" &>/dev/null; then
  userdel -r "$PANEL_USER" 2>/dev/null || userdel "$PANEL_USER" 2>/dev/null || true
  success "Service user '${PANEL_USER}' removed"
fi

echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║          Uninstall Complete!                      ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Kretase has been removed from this server."
if [[ "${KEEP_DB,,}" != "n" ]]; then
  echo "  Database '${DB_NAME}' was kept."
fi
echo ""
echo "  To reinstall:"
echo -e "  ${CYAN}bash <(curl -fsSL https://get.kretase.com/panel)${NC}"
echo ""
