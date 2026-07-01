# Changelog

## v1.1.0

### Added
- **Plugin Manager** — search, install, update, and enable/disable Modrinth plugins directly from the panel, with category filters and sorting.
- **Mod Manager** — same experience for Fabric mods, with automatic loader/Minecraft-version matching. Ships with a new Fabric egg/install script.
- **Version Manager** — browse and switch Paper versions and builds, with a changelog view, downgrade protection, and an optional pre-install backup.
- **World Manager** — switch, back up, export, and delete local worlds; browse and install premade worlds (castles, mansions, and more) from CurseForge.
- **AI Tools** — MOTD and server logo generators. Free built-in algorithm by default; optional real AI generation (OpenAI, Gemini, or Anthropic) using the admin's own API key.
- **Password reset** — self-service reset flow using the panel owner's own configured SMTP.
- **EULA consent flow** — the server owner explicitly accepts or declines Mojang's EULA on first start, instead of it being silently pre-accepted.
- **RGB gradient text tool** in the MOTD Generator.
- `update-wings.sh` — an official one-liner to update the Wings daemon on a node (pull, rebuild, restart), matching `update-panel.sh`.

### Fixed
- PaperMC's `api.papermc.io/v2` was sunset — migrated to `fill.papermc.io/v3` across the panel, Wings, and the Vanilla/Paper install scripts.
- Port allocation race condition that could hand out the same port to two servers created at nearly the same time.
- Server status getting stuck on "Starting"/"Running" after the server had actually stopped.
- Live console output breaking player join/leave detection due to unstripped ANSI escape codes.
- Server templates not passing egg/env correctly, causing install failures.

## v1.0.0

Initial public release — server management, real-time console, resource monitoring, backups, node/egg/user administration.
