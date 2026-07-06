# Egg Guide

Eggs are server templates — they define the Docker image, startup command, install script, and configurable variables for a type of server (Paper, Vanilla, Fabric, Velocity, a SteamCMD game, a Discord bot, anything that runs in a container). Eggs are grouped into **Nests** (categories, e.g. "Minecraft", "Voice Servers").

Kretase ships with a full catalog you can pull from directly — **Admin → Eggs → Browse Community Eggs** — before writing one from scratch. This guide covers writing your own and understanding how an egg actually runs.

## Where eggs live

- **Admin → Eggs** — create, edit, delete nests and eggs manually
- **Admin → Eggs → Browse Community Eggs** — one-click import from a ~300-egg community catalog
- **Import/Export JSON** — on the same page, import a Pterodactyl-format egg export, or export any Kretase egg back to that same JSON format

## Egg fields

| Field | Purpose |
|-------|---------|
| `dockerImage` | The image the server container runs (e.g. `ghcr.io/pterodactyl/yolks:java_21`) |
| `startup` | The command executed inside the container to launch the server, with `{{VARIABLE}}` placeholders |
| `scriptInstall` | A bash script that runs once, before first start, to download/prepare server files |
| `scriptContainer` | The image the install script runs in — often smaller/different from `dockerImage` (e.g. `alpine:3.4` for a script that just does `curl`/`unzip`). Falls back to `dockerImage` if left blank |
| `configStop` | The command or signal sent to gracefully stop the server (e.g. `stop` for a Minecraft console, or `^C` for SIGINT) |
| `logoUrl` | Optional icon shown in the egg picker — auto-resolved from Steam's CDN on import when a Steam App ID is detectable |

The install script always runs as `bash`, with every egg variable exposed as an environment variable, and the server's data directory mounted at `/mnt/server`. It runs once — Wings skips it on subsequent starts once a server binary already exists at the expected path (so switching an existing server's egg config doesn't wipe its files).

## Startup command variables

Anything wrapped in `{{LIKE_THIS}}` inside `startup` gets replaced with the matching environment variable at launch time. Two are handled specially with built-in fallbacks so a missing value never produces a broken command:

- `{{SERVER_MEMORY}}` — falls back to the server's actual configured memory limit if the env var isn't set
- `{{SERVER_JARFILE}}` — falls back to `server.jar` if not set

Example Paper startup command:

```
java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui
```

## Variables (the "Startup Variables" tab on an egg)

Each `EggVariable` maps a form field shown when creating/editing a server to an environment variable available in `startup` and the install script:

| Field | Purpose |
|-------|---------|
| `name` / `description` | Shown to whoever's filling out the server-creation form |
| `envVariable` | The actual env var name, e.g. `SERVER_JARFILE` — this is what you reference as `{{SERVER_JARFILE}}` in `startup` |
| `defaultValue` | Pre-filled value |
| `userViewable` / `userEditable` | Whether a non-admin server owner can see/change it after creation |
| `rules` | Validation rules (Pterodactyl-style, e.g. `required\|string\|max:20`) |

## Writing an egg from scratch — worked example

A minimal egg for a hypothetical "EchoServer" that just needs a jar downloaded and run:

1. **Admin → Eggs → New Nest** (skip if adding to an existing nest, e.g. "Minecraft")
2. **New Egg**:
   - Docker Image: `eclipse-temurin:21-jre-alpine`
   - Script Container: `alpine:3.4` (just needs `curl`, not a JVM)
   - Install Script:
     ```bash
     curl -L -o /mnt/server/server.jar https://example.com/echoserver-latest.jar
     ```
   - Startup: `java -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}`
   - Stop Command: `stop`
3. Add a variable: name "Server Jar", env var `SERVER_JARFILE`, default `server.jar`
4. Save, then create a server using this egg to test it end-to-end

## Importing from Pterodactyl

If you already have eggs for Pterodactyl, use **Import/Export JSON** on the Eggs page and paste the exported egg JSON directly — no reformatting needed. The importer reads the same `meta`, `startup`, `scripts.installation`, and `variables` structure Pterodactyl exports use.

## Community Egg Store

**Admin → Eggs → Browse Community Eggs** pulls from a catalog of real, ready-to-use eggs (Minecraft variants, SteamCMD titles, voice servers, databases, Discord bots) — import individually or in bulk per category. A fresh Kretase install seeds this catalog automatically so a new panel doesn't start with an empty Eggs page.
