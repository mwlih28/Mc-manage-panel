# Installation Guide

This guide covers installing the Panel and Wings, connecting a node, updating, and uninstalling. For a quick start, see the [README](../README.md#one-command-install-ubuntu--debian).

## Requirements

| Component | Requirement |
|-----------|-------------|
| OS | Ubuntu 20.04/22.04/24.04 or Debian 11/12 |
| RAM | 1GB minimum for the panel server; size Wings nodes per the game servers they'll run |
| Domain | A domain/subdomain pointed at the panel server before installing (needed for SSL) |
| Access | Root or sudo on both the panel server and every Wings node |

The panel server and Wings nodes can be the same machine for small setups, or separate machines for anything larger.

## 1. Install the Panel

On the machine that will host the web UI and API:

```bash
bash <(curl -fsSL https://get.kretase.com/panel)
```

The installer will ask for:
- **Panel domain** (e.g. `panel.yourdomain.com`) — point an A record at this server's IP before running the script
- **Admin email, username, password** — creates the first admin account
- **SSL** — whether to provision a Let's Encrypt certificate via Certbot

What it sets up: Node.js, PostgreSQL, the API (as the `kretase` systemd service), the built React frontend served through Nginx, and (optionally) SSL termination.

Once it finishes, open your domain in a browser and sign in with the admin account you created.

## 2. Add a Node (in the Panel)

Before installing Wings, create the node record in the panel so you have a token/setup code to connect it with:

1. **Admin → Nodes → New Node**
2. Fill in a name, the node's public FQDN or IP, memory/disk limits
3. Save — you'll land on the node's **Configuration** tab

From here you have two ways to connect Wings:

- **One-command activation (recommended)** — copy the setup command shown on the Configuration tab. It contains a short-lived setup code; running it on the node fetches the token, FQDN, and port automatically, so you don't type anything by hand.
- **Manual** — copy the **Node Token** shown on the same tab for use with the manual Wings install flow below.

## 3. Install Wings (on each game server node)

Run this on **every machine** that will actually host game server containers:

```bash
bash <(curl -fsSL https://get.kretase.com/wings)
```

If you used the one-command activation setup code from the panel, paste it when prompted and everything else is filled in automatically. Otherwise, the script will ask for:
- **Panel URL** (e.g. `https://panel.yourdomain.com`)
- **Node token** (from Admin → Nodes → your node → Configuration)
- **Wings listen port** (default `8080`)

What it sets up: Docker, Node.js, the Wings daemon (as the `mc-wings` systemd service), and firewall rules (UFW) opening the Wings port, the SFTP port (`2022`), the Minecraft port range (`25565-25600/tcp+udp`), and ranges for common non-Minecraft games from the community egg store (CS2/Source engine, Rust, ARK, Valheim, and others) — see `scripts/install-wings.sh` for the full list. Running `update-wings.sh` re-applies these too, so already-installed nodes pick up newly-added game ports without a separate step.

Once it's running, the node's status in the panel should turn from grey/offline to green/online within a few seconds (Wings authenticates and sends a heartbeat automatically).

## 4. Create a Server

1. **Admin → Servers → New Server**
2. Pick a node, an allocation (IP:port), an egg (e.g. Minecraft Paper — see [the egg guide](./eggs.md) if you want to build your own), and resource limits
3. Click Create — Wings pulls the Docker image, runs the egg's install script, and starts the container

## Updating

```bash
# On the panel server
bash <(curl -fsSL https://get.kretase.com/update-panel)

# On every Wings node
bash <(curl -fsSL https://get.kretase.com/update-wings)
```

Both scripts pull the latest release, reinstall dependencies, rebuild, and restart the relevant systemd service. Your `.env`, `config.yml`, and database are left untouched. Run the Wings updater on **every** node after updating the panel — panel releases sometimes ship new Wings-side functionality (e.g. the SFTP server added in this release) that only takes effect once Wings itself is updated.

## Uninstalling the Panel

```bash
bash <(curl -fsSL https://get.kretase.com/uninstall-panel)
```

This stops and removes the `kretase` systemd service, the Nginx site config, and the panel files. It asks separately whether to keep or drop the database (a final `pg_dump` backup is taken automatically before dropping) and requires typing `yes` to confirm. It does not touch any Wings nodes — game servers keep running on their nodes even if you remove the panel; you'd need to manage them directly via Wings/Docker at that point.

## Troubleshooting

**Node stays offline after installing Wings**
- Check the Wings service is actually running: `systemctl status mc-wings`
- Confirm the panel URL entered during Wings setup is reachable from the node: `curl -I https://your-panel-domain.com/health`
- Check that the node token matches what's shown in Admin → Nodes → your node — regenerating the token on either side without updating the other will break auth

**SSL setup failed during panel install**
- Make sure DNS is actually pointed at the server before running the installer — Certbot's HTTP challenge needs the domain resolving to the machine it's running on
- You can re-run `certbot --nginx -d your-domain.com` manually afterward if the automatic step failed

**Port conflicts**
- The panel installer uses 80/443 (Nginx) and 3001 (API, proxied internally)
- Wings uses 8080 (configurable) for its API and 2022 for SFTP by default — both are set per-node in Admin → Nodes if you need to change them
