# Changelog

## v1.3.0

### Added
- **Outbound webhooks** — Discord embeds or generic HMAC-signed JSON, fired on server/user events (create, delete, power actions, backups, and more), managed from a new Admin → Webhooks page with per-webhook event filtering and test delivery.
- **White-label theming** — a raw custom-CSS field (applies panel-wide, including the login page) and a toggle to hide the "Powered by Kretase" attribution on public status pages.
- **Self-documenting API reference** — a new Admin → API Reference page listing every integration-facing route with its required scope and a copy-able curl example, generated from the same source of truth used to enforce those scopes.
- **Cloud backup destinations** — upload new backups to S3-compatible storage (AWS, Backblaze B2, Cloudflare R2, Wasabi, DigitalOcean Spaces, MinIO), SFTP, or Google Drive, in addition to the local copy on each node.
- **Discord bot control** — `/start`, `/stop`, `/restart`, and `/status` slash commands, bound to a specific server from a one-time code generated in the panel (no Discord-account linking required).
- **Import from Pterodactyl** — a new Admin → Migration wizard that pulls servers from a source Pterodactyl panel's Application API and transfers their actual files (worlds, plugins, configs) over SFTP into Kretase.
- **Installable app + push notifications** — the panel can now be installed to a home screen/desktop like a native app, and sends a real OS-level notification on server crash, suspension, or a security alert — even with no tab open.
- **Billing & store integrations** — real WHMCS and Blesta provisioning modules (downloadable from Admin → Billing & Store) for automatic account creation/suspension/termination on order events, plus Tebex/CraftingStore purchase webhooks that can run a console command (e.g. granting a rank) on a mapped package.

### Security
- Closed an API-key scope enforcement gap on ~48 nested server/backup routes (power actions, file management, players, schedules, and more) that had no scope check at all, meaning a narrowly-scoped API key could still reach them. Added a new `servers:power` scope so automation/billing integrations don't need full write access just to start/stop a server.

## v1.2.0

### Added
- **Server migration between nodes** — move a server (all files, databases, everything) from one node to another without recreating it. Something Pterodactyl doesn't support at all.
- **Real server cloning** — duplicate a live server into a brand-new one without touching or stopping the original.
- **One-click CurseForge/Modrinth modpack install** — pick a modpack and a file version; the panel resolves and installs the Fabric loader plus every mod automatically.
- **Crash auto-restart** — if a server's process exits unexpectedly, Wings restarts it automatically (capped at 3 attempts within a 10-minute window to avoid boot loops). Toggleable per-server from the server's own Settings tab.
- **Persistent resource history** — CPU/memory/disk are now sampled and stored over time, with 1h/24h/7d charts on the Stats tab (previously only live, in-memory data existed and vanished on refresh).
- **Auto-optimize on lag spikes** — if CPU stays above 90% (or memory above 95%) for a sustained minute, the panel automatically clears dropped-item lag and logs what it did. Toggleable per-server.
- **Plugin/mod update tracking for unmanaged files** — jars dropped in manually (not installed through the panel) are now hash-fingerprinted (SHA1 for Modrinth, MurmurHash2 for CurseForge) and matched against the real catalogs, so their available updates show up too.
- **A Schedule tab that actually works** — scheduled tasks (cron-based power actions and console commands) had a full UI but silently executed nothing; there's now a real poller that evaluates cron expressions and runs due tasks, including a 30-second in-game warning before a scheduled stop/restart.
- **Player stats leaderboard** — a sortable leaderboard (playtime, kills, deaths, blocks mined, and more) built from each player's real Minecraft stats files, not fabricated data.
- **Server health score** — a transparent 0–100 score combining crash count, auto-optimize triggers, backup freshness, and recent CPU load, with a visible breakdown of exactly what's pulling the score down (never a black-box number).
- **Suspicious activity alarm** — flags sensitive commands (`/op`, `/ban`, `/whitelist`, etc.) and rapid command spam (possible macro/script abuse) in real time, both in the console and as an in-panel alert.
- **Public shareable status page** — an opt-in, no-login page at `/status/:slug` showing online/offline, player count, and the join address — safe to link from Discord or a website. Rate-limited, and never exposes owner identity or internal IDs.
- **Full public status page customization** — a dedicated Customize tab with a real live preview: accent color, logo, an automatically animated (pan/zoom) banner image, an announcement banner strip, and raw custom CSS for full control — the custom CSS applies only on the live public page, never leaking into the panel itself.
- **Static world map** — a real top-down PNG render of the world, generated by parsing the actual Minecraft region files (`.mca`) and NBT chunk data directly (no Docker port-publishing or third-party map server required), with adjustable radius and coordinate/spawn navigation.
- **Pterodactyl-style one-command node activation** — activating a newly-added node no longer requires manually editing config files on it.
- **Real Minecraft item icons** in the player inventory/ender chest viewer, replacing generic placeholder icons.

### Fixed
- **Backups were completely fake** — the backup system had a full UI and database records but never actually archived or restored any files. It now creates and restores real backups end-to-end.
- **The Schedule tab did nothing** — see above; scheduled tasks now actually run on their configured cron schedule.
- Velocity and TShock eggs referenced `python3`, which isn't present on the Alpine-based images they run on, breaking installs; also fixed a stale API reference in the same eggs.
- The sidebar version badge now reflects the actually-deployed release instead of a hardcoded value.

### Security
- Fixed a 2FA bypass, an IDOR (insecure direct object reference) on scheduled tasks, and missing admin gates on several routes.

### Changed
- Install/update scripts now track the latest tagged GitHub release instead of the `main` branch tip, so updates are predictable and never pull in-progress work.

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
