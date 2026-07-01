# Kretase

**Self-hosted, open-source game server management panel — a modern alternative to Pterodactyl.**

![Status](https://img.shields.io/badge/status-active-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Stars](https://img.shields.io/github/stars/mwlih28/mc-manage-panel?style=flat)
![Last Commit](https://img.shields.io/github/last-commit/mwlih28/mc-manage-panel)

> ⚠️ **This project is under active development.** Core features work, but expect rough edges, breaking changes, and missing polish. Not yet recommended for production use without testing in your own environment first. Feedback and bug reports are very welcome.

Manage Minecraft and other game servers from a web UI — with a Wings daemon on each node, real-time console, resource monitoring, and full admin controls.

---

## Screenshots

![Dashboard](./docs/screenshots/dashboard.jpg)
*User dashboard — server overview, resource stats*

![Server Console](./docs/screenshots/console.jpg)
*Real-time console with live output and command input*

![Admin Panel](./docs/screenshots/admin.jpg)
*Separate admin panel — user/node/egg management*

---

## Why Kretase?

Pterodactyl is a great project, but it comes with real tradeoffs. Here's where this panel takes a different approach:

- **Modern stack, no PHP.** The frontend is React 18 + TypeScript, the backend is Express + Prisma. No Blade templates, no Laravel — easier to contribute to and extend.
- **Single-command install.** One `bash` command sets up the panel (Nginx, PostgreSQL, SSL) and another sets up Wings. Pterodactyl's install involves multiple manual steps across several guides.
- **Unified codebase.** Panel and Wings daemon live in the same monorepo. One `git pull` updates everything; no version drift between components.
- **Actively opinionated defaults.** Aikar's JVM flags pre-configured, sane resource limits out of the box, modern Docker images — sensible starting point without tuning everything manually.

> **Honest note:** Pterodactyl has years of production hardening, a large plugin ecosystem, and broader egg support. If you need that maturity today, use Pterodactyl. If you want a modern stack you can hack on, this is for you.

---

## One-command Install (Ubuntu / Debian)

### 1 — Install the Panel (on your panel server)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-panel.sh)
```

The script will ask for:
- Your panel domain (e.g. `panel.yourdomain.com`) — point DNS before running
- Admin email, username, and password
- Whether to set up SSL with Let's Encrypt

After it finishes, open your domain in a browser and sign in.

### 2 — Install Wings (on each game server / node)

Run this on **every server** that will host game servers:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-wings.sh)
```

The script will ask for:
- Your panel URL (e.g. `https://panel.yourdomain.com`)
- Node token — get this from **Admin → Nodes → your node** in the panel
- This server's public IP or FQDN
- Wings port (default: 8080)

### Supported OS

| OS | Versions |
|----|----------|
| Ubuntu | 20.04, 22.04, 24.04 |
| Debian | 11, 12 |

---

## Features

- **Server Management** — Create, start, stop, restart, kill game servers
- **Real-time Console** — Live server output + command input via WebSocket, with history replay on reconnect
- **Resource Monitoring** — CPU, RAM, disk stats streamed from Wings nodes
- **Plugin Manager** — Search, install, update, enable/disable Paper/Spigot/Bukkit plugins directly from Modrinth — no manual `.jar` uploads needed
- **Mod Manager** — Same experience for Fabric mods, with automatic loader/Minecraft-version matching
- **Version Manager** — Browse and switch Paper versions/builds with changelog view, downgrade protection, and an optional pre-install backup
- **World Manager** — Manage local worlds (switch active world, export/download, delete) and browse/install premade worlds (castles, mansions, and more) from CurseForge
- **Backup System** — Create and restore server backups
- **Player Management** — Online/offline player list, ban/kick/IP-ban, inventory & ender chest viewer
- **EULA Consent Flow** — Server owner explicitly accepts/declines Mojang's EULA on first start
- **Scheduled Tasks** — Cron-based power actions and console commands per server
- **Subuser Access Control** — Grant other users scoped access to a server
- **AI Tools** — MOTD and server logo generators; free built-in algorithm by default, optional real AI generation (OpenAI/Gemini/Anthropic) using the admin's own API key
- **Password Reset** — Self-service reset via the panel owner's own configured SMTP
- **User Management** — Admin and user roles, create/edit/delete users
- **Node Management** — Add Wings nodes, manage port allocations
- **Egg System** — Server configuration templates (Minecraft Paper, Bedrock, Vanilla, Fabric, BungeeCord, Velocity, and more)
- **Activity Log** — Full audit trail of panel actions
- **JWT Authentication** — Access + refresh token pair, secure bcrypt hashing
- **Dark UI** — Modern responsive dark-themed interface

---

## How it works

```
[ Browser ]
     │  HTTPS
     ▼
[ Panel (Nginx) ]
     ├── /          → React SPA (static files)
     ├── /api/      → Express API  (port 3001)
     └── /socket.io → Socket.io    (port 3001)

[ Wings Daemon ] ← Panel API communicates over HTTP/WS
     └── Docker containers (one per game server)
```

The **Panel** is the web UI + API, installed once.  
**Wings** is a lightweight daemon installed on each machine that will run game servers. It manages Docker containers and streams console output back to the panel.

---

## After Installation

### First login
1. Go to `https://your-panel-domain.com`
2. Sign in with the admin credentials you set during install

### Add a node
1. **Admin → Nodes → New Node**
2. Fill in the FQDN / IP of your game server, port 8080, memory & disk limits
3. Copy the **Node Token** from the Configuration tab

### Connect Wings
1. SSH into your game server
2. Run the Wings install script (pasted above)
3. Enter the Panel URL and the token you just copied
4. Back in the panel, the node status should turn green

### Create a server
1. **Admin → Servers → New Server**
2. Pick a node, allocation, egg (e.g. Minecraft Paper), resource limits
3. Click Create — Wings downloads the egg and starts the container

---

## Updating

```bash
# On the panel server:
bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-panel.sh)

# On each Wings node:
bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-wings.sh)
```

Both scripts back up what needs backing up, pull the latest code, rebuild, and restart — your `.env`, `config.yml`, and database are left untouched. Run the Wings updater on every node after updating the panel, since panel releases sometimes ship new Wings-side functionality.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Express, TypeScript, Prisma ORM |
| Database | PostgreSQL |
| Real-time | Socket.io |
| Node daemon | Node.js + Dockerode |
| Auth | JWT + bcrypt |
| Proxy | Nginx |

---

## Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL (or Docker)

```bash
git clone https://github.com/mwlih28/mc-manage-panel.git
cd mc-manage-panel

# Install API deps
cd apps/api && npm install

# Configure
cp .env.example .env   # edit DATABASE_URL, JWT_SECRET, etc.

# Apply schema + seed
npx prisma db push
npx ts-node src/utils/seed.ts

# Start API (port 3001)
npm run dev
```

```bash
# In another terminal — start web (port 5173)
cd apps/web && npm install && npm run dev
```

---

## Environment Variables

### API (`apps/api/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | JWT signing secret (32+ chars) |
| `JWT_REFRESH_SECRET` | yes | Refresh token secret (32+ chars) |
| `CORS_ORIGIN` | yes | Panel URL for CORS |
| `PORT` | no | API port (default `3001`) |

### Web (build-time)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Full API URL — leave empty for same-domain nginx proxy |

---

## API Reference

```
GET    /health

POST   /api/v1/auth/login
POST   /api/v1/auth/register
POST   /api/v1/auth/refresh
GET    /api/v1/auth/me
GET    /api/v1/auth/setup/status
POST   /api/v1/auth/setup

GET    /api/v1/servers
POST   /api/v1/servers          (admin)
GET    /api/v1/servers/:id
PATCH  /api/v1/servers/:id      (admin)
DELETE /api/v1/servers/:id      (admin)
POST   /api/v1/servers/:id/power

GET    /api/v1/nodes            (admin)
POST   /api/v1/nodes            (admin)
GET    /api/v1/nodes/:id/allocations
POST   /api/v1/nodes/:id/allocations  (admin)

GET    /api/v1/users            (admin)
POST   /api/v1/users            (admin)
PATCH  /api/v1/users/:id        (admin)
DELETE /api/v1/users/:id        (admin)

GET    /api/v1/eggs             (admin)
GET    /api/v1/stats            (admin)
GET    /api/v1/stats/overview

# Wings (daemon-to-panel)
GET    /api/v1/wings/node
POST   /api/v1/wings/heartbeat
GET    /api/v1/wings/servers
```

---

## Roadmap

Planned features — contributions welcome:

- [ ] **2FA / TOTP support** — Two-factor authentication for panel accounts
- [ ] **Discord webhook notifications** — Server state changes, alerts, and activity events pushed to a Discord channel
- [ ] **Multi-language UI** — Language switcher (English, Chinese, and more)
- [ ] **Billing/subscriptions** — Plan-based server provisioning with automated payments
- [ ] **More egg presets** — Counter-Strike 2, ARK, Rust, Terraria, and community-contributed eggs via a marketplace

---

## Contributing

Contributions are welcome. Here's the flow:

1. **Open an issue first** for anything non-trivial — describe the problem or feature so we can align before you spend time coding.
2. Fork the repo and create a branch: `git checkout -b feat/your-feature`
3. Make your changes, keep commits focused and descriptive.
4. Open a pull request against `main`. Link the related issue in the PR description.

For bug reports, include your OS, Node version, and relevant logs. For feature requests, explain the use case.

---

## VIRUSTOTAL

Install-panel.sh : https://www.virustotal.com/gui/file/46c5af7da89b7968dcf68e2bf6d81303ba4ceeff5b83492ceec287218aed573a

Install-wings.sh : https://www.virustotal.com/gui/file/a06dc0493715a3677a373157b8c27a9569a116aefeb1fa30132ec3ad4183512c

---

## Contact

Got an idea, found a bug, or just want to reach out? Email: **mwlih28@gmail.com**

---

## Acknowledgments

Email delivery uses [Resend](https://resend.com) — thanks for letting us use their name and mark. This is not an official or approved Resend integration.

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=mwlih28/mc-manage-panel&type=Date)](https://star-history.com/#mwlih28/mc-manage-panel&Date)

---

## License

MIT
