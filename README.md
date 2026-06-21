# MC Manage Panel

A comprehensive game server management panel inspired by Pterodactyl Panel. Built with React, Express, TypeScript, and Socket.io.

![Dashboard](https://img.shields.io/badge/status-active-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

## Features

- **Server Management** — Create, start, stop, restart, and kill game servers
- **Real-time Console** — Live server console with command input via WebSocket
- **Resource Monitoring** — Real-time CPU, RAM, disk, and network stats
- **Backup System** — Create and manage server backups
- **User Management** — Full RBAC with admin and user roles
- **Node Management** — Manage daemon nodes and port allocations
- **Egg System** — Server configuration templates (Minecraft, etc.)
- **Activity Log** — Track all panel activity
- **JWT Auth** — Secure authentication with refresh token rotation
- **Dark UI** — Modern dark-themed interface

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Express, TypeScript, Prisma ORM |
| Database | PostgreSQL (SQLite for dev) |
| Real-time | Socket.io |
| Auth | JWT + bcrypt |

---

## Quick Start (Docker)

The fastest way to run the panel locally or on a VPS:

```bash
git clone https://github.com/mwlih28/mc-manage-panel.git
cd mc-manage-panel

# Copy and edit environment variables
cp apps/api/.env.example .env
# Edit .env with your settings

# Start everything
docker compose up -d

# Run database seed (first time only)
docker compose exec api npx ts-node src/utils/seed.ts
```

Open http://localhost in your browser.

**Default credentials:**
- Admin: `admin@example.com` / `Admin123!`
- User: `user@example.com` / `User123!`

---

## Development Setup

### Prerequisites
- Node.js 20+
- Docker (for PostgreSQL) OR local PostgreSQL

### 1. Clone and install
```bash
git clone https://github.com/mwlih28/mc-manage-panel.git
cd mc-manage-panel

npm install
cd apps/api && npm install
cd ../web && npm install
```

### 2. Start PostgreSQL
```bash
docker compose -f docker-compose.dev.yml up -d
```

### 3. Configure API
```bash
cp apps/api/.env.development apps/api/.env
```

### 4. Setup database
```bash
cd apps/api
npx prisma migrate dev
npx ts-node src/utils/seed.ts
```

### 5. Start dev servers
```bash
# Terminal 1 — API (port 3001)
cd apps/api && npm run dev

# Terminal 2 — Web (port 5173)
cd apps/web && npm run dev
```

---

## Production Deployment

### Option A: Railway (Recommended — Free)

**Backend:**
1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Select the `apps/api` folder as the root
3. Add a **PostgreSQL** database service
4. Set environment variables (see `.env.example`)
5. Railway auto-deploys on every push to `main`

**Frontend:**
1. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
2. Set root directory to `apps/web`
3. Add environment variable: `VITE_API_URL=https://your-railway-api-url.railway.app`
4. Deploy

### Option B: VPS with Docker

```bash
# On your server
git clone https://github.com/mwlih28/mc-manage-panel.git
cd mc-manage-panel

# Create .env with production values
cat > .env << EOF
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
CORS_ORIGIN=https://your-domain.com
API_URL=https://api.your-domain.com
EOF

# Build and start
docker compose up -d --build

# Seed database
docker compose exec api node dist/utils/seed.js
```

### Option C: GitHub Container Registry

After pushing to `main`, Docker images are built automatically:

```
ghcr.io/mwlih28/mc-manage-panel/api:latest
ghcr.io/mwlih28/mc-manage-panel/web:latest
```

---

## Environment Variables

### API (`apps/api/.env`)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Refresh token secret (min 32 chars) | `openssl rand -hex 32` |
| `CORS_ORIGIN` | Frontend URL for CORS | `https://panel.yourdomain.com` |
| `PORT` | API server port | `3001` |

### Web (`apps/web/.env`)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | API server URL | `https://api.yourdomain.com` |

---

## API Endpoints

```
POST   /api/v1/auth/login
POST   /api/v1/auth/register
POST   /api/v1/auth/refresh
GET    /api/v1/auth/me

GET    /api/v1/servers
POST   /api/v1/servers
GET    /api/v1/servers/:id
PATCH  /api/v1/servers/:id
DELETE /api/v1/servers/:id
POST   /api/v1/servers/:id/power
GET    /api/v1/servers/:id/backups
POST   /api/v1/servers/:id/backups

GET    /api/v1/nodes
POST   /api/v1/nodes
GET    /api/v1/nodes/:id/allocations
POST   /api/v1/nodes/:id/allocations

GET    /api/v1/users          (admin)
POST   /api/v1/users          (admin)
PATCH  /api/v1/users/:id      (admin)
DELETE /api/v1/users/:id      (admin)

GET    /api/v1/stats           (admin)
GET    /api/v1/stats/overview
```

---

## License

MIT
