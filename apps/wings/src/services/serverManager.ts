import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { Server as SocketServer } from 'socket.io';
import Docker from 'dockerode';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import {
  createContainer, containerExists, imageExists, pullImage,
  getDocker, getContainerStats, ensureVolumePermissions,
} from './dockerService';
import { panelClient } from './panelClient';
import type { ServerConfig, ServerStatus, ResourceUsage } from '../types';

const MAX_LOG_BUFFER = 500;

// Suspicious-activity detection: Minecraft (vanilla and every Bukkit-family
// fork) logs every command a player runs — "<name> issued server command:
// /<cmd>" — regardless of whether a plugin is installed, which makes it the
// one reliable signal available without depending on a moderation plugin.
// Block-break/place events are NOT logged by default, so griefing-by-
// building can't be detected this way — this only covers command abuse
// (privilege escalation, macro/script spam), which is still a real and
// common attack surface (a compromised or shared account running /op on
// itself, or a script hammering commands).
const SENSITIVE_COMMANDS = ['op', 'deop', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'whitelist', 'stop', 'save-off', 'difficulty'];
const COMMAND_SPAM_WINDOW_MS = 10 * 1000;
const COMMAND_SPAM_THRESHOLD = 8;

// Crash auto-restart: how many unexpected exits are tolerated in the
// window before Wings gives up and leaves the server offline, so a
// broken jar/config can't boot-loop forever.
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const MAX_CRASHES_IN_WINDOW = 3;
const CRASH_RESTART_DELAY_MS = 5000;

// TTY-attached containers (used for proper console interaction) often emit ANSI color
// codes that break the join/leave regex matching below — strip them before processing.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g;
function stripAnsi(line: string): string {
  return line.replace(ANSI_PATTERN, '');
}

interface ManagedServer {
  config: ServerConfig;
  status: ServerStatus;
  containerId?: string;
  startedAt?: Date;
  statsInterval?: ReturnType<typeof setInterval>;
  logStream?: NodeJS.ReadableStream;
  stdinStream?: NodeJS.ReadWriteStream;
  logBuffer: string[];
}

export interface PlayerHistoryEntry {
  name: string;
  uuid: string;
  firstSeen: Date;
  lastSeen: Date;
  joinCount: number;
  online: boolean;
}

class ServerManager extends EventEmitter {
  private servers = new Map<string, ManagedServer>();
  private playerSessions = new Map<string, Map<string, string>>(); // serverUuid -> Map<playerName, playerUuid>
  private allPlayerHistory = new Map<string, Map<string, PlayerHistoryEntry>>(); // serverUuid -> Map<playerName, entry>
  private crashTimestamps = new Map<string, number[]>(); // serverUuid -> recent unexpected-exit times
  private commandTimestamps = new Map<string, Map<string, number[]>>(); // serverUuid -> playerName -> recent command times
  private io?: SocketServer;

  setSocketServer(io: SocketServer) {
    this.io = io;
  }

  private isBedrockServer(uuid: string): boolean {
    const env = this.servers.get(uuid)?.config.environment ?? {};
    return env['SERVER_TYPE'] === 'BEDROCK';
  }

  async loadServer(config: ServerConfig): Promise<void> {
    const existing = this.servers.get(config.uuid);
    const cfg = getConfig();
    const dataPath = path.join(cfg.system.data, config.uuid);
    fs.mkdirSync(dataPath, { recursive: true });

    // Check if container already running
    const containerId = await containerExists(config.uuid);
    let status: ServerStatus = 'offline';

    if (containerId) {
      try {
        const d = getDocker();
        const container = d.getContainer(containerId);
        const info = await container.inspect();
        if (info.State.Running) {
          status = 'running';
        }
      } catch { /* container gone */ }
    }

    const existingBuffer = this.servers.get(config.uuid)?.logBuffer ?? [];
    this.servers.set(config.uuid, {
      config,
      status,
      containerId: containerId || undefined,
      startedAt: status === 'running' ? new Date() : undefined,
      logBuffer: existingBuffer,
    });

    if (status === 'running' && containerId) {
      this.attachLogStream(config.uuid, containerId);
      this.startStatsInterval(config.uuid);
      this.attachStdinStream(config.uuid, containerId);
      // Query existing online players after Wings attaches to a running server
      setTimeout(() => this.sendCommand(config.uuid, 'list').catch(() => {}), 3000);
    }

    logger.info(`Server loaded: ${config.uuid} (${status})`);
  }

  // Applies a resource-limit change without a restart. Always updates the
  // in-memory config (so the new limits stick on the next natural restart
  // even if the live docker update below can't apply, e.g. server offline
  // or a cgroup driver that rejects a live change) and, when a container
  // exists, pushes Memory/CPU/BlkioWeight to the running container via
  // Docker's live update API — the same math createContainer() uses so a
  // plan upgrade behaves identically to a fresh install.
  async updateBuild(uuid: string, build: Partial<ServerConfig['build']>): Promise<void> {
    const server = this.servers.get(uuid);
    if (!server) throw new Error(`Server ${uuid} not found`);

    server.config.build = { ...server.config.build, ...build };
    const { build: limits } = server.config;

    if (!server.containerId) return;

    try {
      const heapMb = limits.memory_limit;
      const containerMb = heapMb + 512;
      const memBytes = containerMb * 1024 * 1024;
      const swapBytes = limits.swap > 0 ? (containerMb + limits.swap) * 1024 * 1024 : -1;
      const cpuQuota = limits.cpu_limit > 0 ? Math.floor(limits.cpu_limit * 1000) : -1;

      const container = getDocker().getContainer(server.containerId);
      await container.update({
        Memory: memBytes,
        MemorySwap: swapBytes,
        CpuQuota: cpuQuota,
        CpuPeriod: 100000,
        BlkioWeight: limits.io_weight,
      });
      logger.info(`Live resource update applied for ${uuid}: ${heapMb}MB heap, cpu=${limits.cpu_limit}%`);
    } catch (err) {
      // Not fatal — config above is already updated, so the new limits take
      // effect on the server's next start regardless of this failing.
      logger.warn(`Live resource update failed for ${uuid} (will apply on next restart): ${(err as Error).message}`);
    }
  }

  async startServer(uuid: string): Promise<void> {
    const server = this.servers.get(uuid);
    if (!server) throw new Error(`Server ${uuid} not found`);
    if (server.status === 'running' || server.status === 'starting' || server.status === 'stopping') return;

    // Fresh start, fresh console — otherwise leftover output from a previous
    // run (a crash, a stuck install, etc.) stays mixed in with the new run's
    // logs both for reconnecting clients (history replay) and anyone already
    // sitting on the console tab, making it look like the old problem is
    // still happening when it's actually just old text.
    server.logBuffer = [];
    this.io?.to(`server:${uuid}`).emit('server:console:clear', { uuid });

    this.setStatus(uuid, 'starting');
    const cfg = getConfig();
    const dataPath = path.join(cfg.system.data, uuid);
    fs.mkdirSync(dataPath, { recursive: true });

    try {
      const { config } = server;
      const isBedrock = this.isBedrockServer(uuid);

      if (!isBedrock) {
        // Write eula.txt based on the operator's explicit consent (EULA_ACCEPTED env,
        // set when the server was created) — only on first write. Once the file exists
        // we leave it untouched instead of silently flipping eula=false to true.
        const eulaPath = path.join(dataPath, 'eula.txt');
        if (!fs.existsSync(eulaPath)) {
          const accepted = config.environment.EULA_ACCEPTED === 'true';
          fs.writeFileSync(eulaPath, `eula=${accepted}\n`, 'utf8');
        }
      }

      // Substitute {{VAR}} placeholders in invocation with environment values.
      // Fall back to sensible defaults for critical JVM variables so a missing
      // SERVER_MEMORY in env never produces a broken -XmsM flag.
      const invocation = config.invocation.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const k = key.trim();
        if (k === 'SERVER_MEMORY') return config.environment[k] || String(config.build.memory_limit);
        if (k === 'SERVER_JARFILE') return config.environment[k] || 'server.jar';
        return config.environment[k] ?? '';
      });

      // Make the data directory world-writable BEFORE install so the install
      // container (uid 1000) can write files into it.
      try { fs.chmodSync(dataPath, 0o777); } catch { /* non-fatal */ }

      // Pull image if needed
      if (!await imageExists(config.image)) {
        this.sendConsole(uuid, `[Wings] Pulling image ${config.image}...`);
        await pullImage(config.image);
      }

      // Run install script on first start (when server binary/jar doesn't exist)
      const isBedrockBinary = isBedrock;
      const jarFile = config.environment['SERVER_JARFILE'] || 'server.jar';
      const firstStartFile = isBedrockBinary ? 'bedrock_server' : jarFile;
      const isFirstStart = !fs.existsSync(path.join(dataPath, firstStartFile));
      if (isFirstStart && config.installScript) {
        this.sendConsole(uuid, '[Wings] Running install script...');
        try {
          await this.runInstallScript(uuid, config, dataPath);
          this.sendConsole(uuid, '[Wings] Install complete.');
        } catch (err) {
          this.sendConsole(uuid, `[Wings] Install failed: ${(err as Error).message}`);
          this.setStatus(uuid, 'offline');
          throw err;
        }
      }

      if (!isBedrock) {
        // Pre-create subdirectories that server software needs (e.g. Paper's cache/).
        // chmod 777 so any container uid can write without requiring a root chown.
        for (const dir of ['cache', 'logs', 'config']) {
          const dirPath = path.join(dataPath, dir);
          fs.mkdirSync(dirPath, { recursive: true });
          try { fs.chmodSync(dirPath, 0o777); } catch { /* non-fatal */ }
        }
        this.sendConsole(uuid, '[Wings] Prepared server directories.');
      }

      if (!isBedrock) {
        // Write optimized Java server.properties on first start (before Paper generates defaults).
        // view-distance=7 and simulation-distance=4 reduce chunk loading pressure by ~50%
        // vs the Paper default of 10, eliminating the main source of TPS lag.
        const propsFile = path.join(dataPath, 'server.properties');
        if (!fs.existsSync(propsFile)) {
          const serverPort = parseInt(
            config.environment['SERVER_PORT'] || config.environment['PORT'] || '25565', 10
          );
          const props = [
            '#Minecraft server properties — optimized defaults by Kretase',
            `server-port=${serverPort}`,
            'online-mode=false',
            'view-distance=7',
            'simulation-distance=4',
            'max-tick-time=60000',
            'max-players=20',
            'motd=A Minecraft Server',
            'spawn-protection=16',
            'allow-flight=false',
            'enable-rcon=false',
            'level-name=world',
            'gamemode=survival',
            'difficulty=normal',
          ].join('\n') + '\n';
          try {
            fs.writeFileSync(propsFile, props, 'utf8');
            this.sendConsole(uuid, '[Wings] Wrote optimized server.properties (view-distance=7, simulation-distance=4)');
          } catch { /* non-fatal — Paper will create its own */ }
        } else {
          // Patch view-distance and simulation-distance in existing server.properties
          // if they are still at the heavy Paper default of 10.
          try {
            let props = fs.readFileSync(propsFile, 'utf8');
            let changed = false;
            if (/^view-distance=10$/m.test(props)) {
              props = props.replace(/^view-distance=10$/m, 'view-distance=7');
              changed = true;
            }
            if (/^simulation-distance=10$/m.test(props)) {
              props = props.replace(/^simulation-distance=10$/m, 'simulation-distance=4');
              changed = true;
            }
            if (changed) {
              fs.writeFileSync(propsFile, props, 'utf8');
              this.sendConsole(uuid, '[Wings] Patched server.properties: view-distance=7, simulation-distance=4');
            }
          } catch { /* non-fatal */ }
        }
      } else {
        // Write Bedrock server.properties on first start
        const bedrockPropsFile = path.join(dataPath, 'server.properties');
        if (!fs.existsSync(bedrockPropsFile)) {
          const serverPort = parseInt(
            config.environment['SERVER_PORT'] || config.environment['PORT'] || '19132', 10
          );
          const bedrockProps = [
            'server-name=Dedicated Server',
            'gamemode=survival',
            'difficulty=easy',
            'allow-cheats=false',
            'max-players=20',
            'online-mode=false',
            'white-list=false',
            `server-port=${serverPort}`,
            `server-portv6=${serverPort + 1}`,
            'view-distance=32',
            'tick-distance=4',
            'player-idle-timeout=30',
            'max-threads=8',
            'level-name=Bedrock level',
            'level-seed=',
            'default-player-permission-level=member',
            'texturepack-required=false',
            'content-log-file-enabled=false',
            'compression-threshold=1',
            'server-authoritative-movement=server-auth',
            'network-compression-threshold=600',
            'correct-player-movement=false',
            'server-authoritative-block-breaking=false',
            'chat-restriction=None',
            'disable-player-interaction=false',
            'client-side-chunk-generation-enabled=true',
            'block-network-ids-are-hashes=true',
            'disable-persona=false',
            'disable-custom-skins=false',
          ].join('\n') + '\n';
          try {
            fs.writeFileSync(bedrockPropsFile, bedrockProps, 'utf8');
            this.sendConsole(uuid, '[Wings] Wrote Bedrock server.properties');
          } catch { /* non-fatal */ }
        }
      }

      // Ensure all files in the volume are owned by UID 1000 so the container
      // user can write them (Wings writes eula.txt etc. as the mcwings OS user,
      // which has a different UID). This also fixes server.properties being
      // unwritable on subsequent starts.
      // BDS runs as root (uid 0) so we can skip volume permissions for Bedrock.
      if (!isBedrock) {
        try {
          await ensureVolumePermissions(config.image, dataPath);
        } catch (err) {
          logger.warn(`ensureVolumePermissions failed (non-fatal): ${(err as Error).message}`);
        }
      }

      // Remove old container if exists
      const existingId = await containerExists(uuid);
      if (existingId) {
        try {
          await getDocker().getContainer(existingId).remove({ force: true });
        } catch { /* ignore */ }
      }

      // Create new container
      this.sendConsole(uuid, '[Wings] Creating container...');
      const container = await createContainer(
        uuid,
        config.image,
        invocation,
        config.environment,
        {
          memory: config.build.memory_limit,
          swap: config.build.swap,
          cpu: config.build.cpu_limit,
          disk: config.build.disk_space,
          io: config.build.io_weight,
          oomDisabled: config.build.oom_disabled,
        },
        dataPath
      );

      await container.start();
      server.containerId = container.id;
      server.startedAt = new Date();
      this.setStatus(uuid, 'running');

      // Discard any lingering stream from the previous run before attaching fresh
      if (server.logStream) {
        try { (server.logStream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
        server.logStream = undefined;
      }
      this.attachLogStream(uuid, container.id);
      this.startStatsInterval(uuid);
      this.attachStdinStream(uuid, container.id);

      logger.info(`Server started: ${uuid}`);
    } catch (err) {
      logger.error(`Failed to start server ${uuid}:`, err);
      this.setStatus(uuid, 'offline');
      this.sendConsole(uuid, `[Wings] Failed to start: ${(err as Error).message}`);
      throw err;
    }
  }

  async stopServer(uuid: string, kill = false): Promise<void> {
    const server = this.servers.get(uuid);
    if (!server) throw new Error(`Server ${uuid} not found`);
    if (server.status === 'offline' || server.status === 'stopping') return;

    this.setStatus(uuid, 'stopping');
    clearInterval(server.statsInterval);

    if (server.containerId) {
      try {
        const d = getDocker();
        const container = d.getContainer(server.containerId);

        if (kill) {
          await container.kill();
        } else {
          const stopCmd = (server.config.environment['MC_STOP_COMMAND'] || 'stop').replace(/"/g, '\\"');

          // Use the persistent stdinStream first — most reliable path to Minecraft stdin
          if (server.stdinStream) {
            try {
              server.stdinStream.write(stopCmd + '\n');
              await new Promise(r => setTimeout(r, 500));
            } catch { /* stream may be closing */ }
          } else {
            // Fall back to exec writing to PID 1's stdin fd
            try {
              const exec = await container.exec({
                AttachStdin: true,
                AttachStdout: false,
                AttachStderr: false,
                Cmd: ['/bin/sh', '-c', `echo "${stopCmd}" > /proc/1/fd/0`],
              });
              await exec.start({ hijack: true, stdin: true });
            } catch {
              try {
                const stream = await container.attach({ stream: true, stdin: true, stdout: false, stderr: false });
                stream.write(stopCmd + '\n');
                stream.end();
              } catch { /* best effort */ }
            }
          }

          await new Promise(r => setTimeout(r, 8000));
          try { await container.stop({ t: 15 }); } catch { /* may already be stopped */ }
        }

        await container.remove({ force: true }).catch(() => { /* ignore */ });
      } catch (err) {
        logger.error(`Error stopping container for ${uuid}:`, err);
      }
    }

    // Destroy logStream only after the container is gone so shutdown logs flow through
    if (server.logStream) {
      try { (server.logStream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
      server.logStream = undefined;
    }

    // Clean up streams after the stop command was sent and container is gone
    if (server.stdinStream) {
      try { (server.stdinStream as NodeJS.ReadWriteStream & { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
      server.stdinStream = undefined;
    }

    server.containerId = undefined;
    server.startedAt = undefined;
    this.setStatus(uuid, 'offline');
    logger.info(`Server stopped: ${uuid}`);
  }

  async restartServer(uuid: string): Promise<void> {
    const server = this.servers.get(uuid);
    if (!server) return;
    // Prevent double-restart: if already stopping or offline nothing useful to do
    if (server.status === 'stopping') return;
    await this.stopServer(uuid);
    await new Promise(r => setTimeout(r, 1000));
    await this.startServer(uuid);
  }

  async killServer(uuid: string): Promise<void> {
    await this.stopServer(uuid, true);
  }

  async sendCommand(uuid: string, command: string): Promise<void> {
    const server = this.servers.get(uuid);
    if (!server || server.status !== 'running' || !server.containerId) return;

    // Prefer the persistent PTY stdin stream (attached when container started)
    if (server.stdinStream) {
      try {
        server.stdinStream.write(command + '\n');
        return;
      } catch {
        server.stdinStream = undefined;
      }
    }

    // Stdin stream was lost — re-attach and retry once
    await this.attachStdinStream(uuid, server.containerId);
    // Re-read from the map; TypeScript's narrowing doesn't track async mutation
    const stdin = this.servers.get(uuid)?.stdinStream;
    if (stdin) {
      try {
        stdin.write(command + '\n');
        return;
      } catch {
        const srv = this.servers.get(uuid);
        if (srv) srv.stdinStream = undefined;
      }
    }

    // Last resort: docker exec to find the Java process and write to its stdin fd
    try {
      const d = getDocker();
      const container = d.getContainer(server.containerId);
      const safeCmd = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`');
      const exec = await container.exec({
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        Cmd: ['/bin/sh', '-c',
          `JPID=$(pgrep -n -f java 2>/dev/null); echo "${safeCmd}" > /proc/\${JPID:-1}/fd/0`,
        ],
      });
      await exec.start({ hijack: false, stdin: false });
    } catch (err) {
      logger.error(`Failed to send command to ${uuid}:`, err);
    }
  }

  getStatus(uuid: string): ServerStatus {
    return this.servers.get(uuid)?.status || 'offline';
  }

  getServerEnvironment(uuid: string): Record<string, string> {
    return this.servers.get(uuid)?.config.environment ?? {};
  }

  async getResources(uuid: string): Promise<ResourceUsage> {
    const server = this.servers.get(uuid);
    if (!server || server.status !== 'running' || !server.containerId) {
      return {
        memory_bytes: 0,
        memory_limit_bytes: (server?.config.build.memory_limit || 0) * 1024 * 1024,
        cpu_absolute: 0,
        disk_bytes: 0,
        network_rx_bytes: 0,
        network_tx_bytes: 0,
        uptime: 0,
        state: server?.status || 'offline',
      };
    }

    const stats = await getContainerStats(server.containerId).catch(() => ({
      cpu: 0, memoryBytes: 0, memoryLimitBytes: 0, networkRx: 0, networkTx: 0,
    }));

    const uptime = server.startedAt
      ? Math.floor((Date.now() - server.startedAt.getTime()) / 1000)
      : 0;

    const dataPath = path.join(getConfig().system.data, uuid);
    const diskBytes = await getDirSize(dataPath).catch(() => 0);

    return {
      memory_bytes: stats.memoryBytes,
      memory_limit_bytes: stats.memoryLimitBytes || server.config.build.memory_limit * 1024 * 1024,
      cpu_absolute: stats.cpu,
      disk_bytes: diskBytes,
      network_rx_bytes: stats.networkRx,
      network_tx_bytes: stats.networkTx,
      uptime,
      state: server.status,
    };
  }

  async reinstallServer(uuid: string, externalConfig?: ServerConfig): Promise<void> {
    const server = this.servers.get(uuid);
    // Prefer the panel's freshly-sent config over whatever Wings already has
    // cached in memory — a reinstall exists specifically to pick up egg
    // changes (image, install script, startup, variables) made since the
    // server was first loaded, so the stale in-memory copy must never win.
    const config = externalConfig ?? server?.config;
    if (!config) throw new Error('Server not found — provide config in request body');

    // Load into memory if not already there so status updates work
    if (!server && externalConfig) {
      await this.loadServer(externalConfig).catch(() => {});
    } else if (server && externalConfig) {
      // Keep the cache in sync so a subsequent plain Start (which only ever
      // reads server.config, with no way to pass fresh config of its own)
      // also uses the corrected values instead of reverting to the old ones.
      server.config = externalConfig;
    }

    if (server?.status && server.status !== 'offline') {
      await this.stopServer(uuid).catch(() => {});
      await new Promise(r => setTimeout(r, 4000));
    }

    const cfg = getConfig();
    const dataPath = path.join(cfg.system.data, uuid);

    if (fs.existsSync(dataPath)) {
      for (const f of fs.readdirSync(dataPath)) {
        fs.rmSync(path.join(dataPath, f), { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(dataPath, { recursive: true });
    }

    this.setStatus(uuid, 'installing');
    this.sendConsole(uuid, '[Wings] Reinstalling server...');

    if (config.installScript) {
      await this.runInstallScript(uuid, config, dataPath);
    }

    this.setStatus(uuid, 'offline');
    this.sendConsole(uuid, '[Wings] Reinstall complete. Start the server to launch.');
  }

  private async runInstallScript(uuid: string, config: ServerConfig, dataPath: string): Promise<void> {
    const d = getDocker();
    const installName = `mc_install_${uuid}`;

    // Use scriptContainer if provided, otherwise fall back to server image
    const installImage = config.scriptContainer || config.image;
    if (!await imageExists(installImage)) {
      this.sendConsole(uuid, `[Wings] Pulling image ${installImage}...`);
      await pullImage(installImage);
    }

    // Remove stale install container
    try {
      const existing = await d.listContainers({ all: true, filters: { name: [installName] } });
      if (existing.length > 0) await d.getContainer(existing[0].Id).remove({ force: true });
    } catch { /* ignore */ }

    // Write install script to data dir. Volume ownership is handled separately by
    // ensureVolumePermissions(), so the install runs as uid 1000 on a writable dir.
    // Many community-egg install scripts carry CRLF line endings (Windows-authored
    // source files) — bash chokes on the stray \r with "command not found" and an
    // "unexpected end of file" syntax error, so normalize before writing to disk.
    const scriptFile = path.join(dataPath, '.wings_install.sh');
    const normalizedScript = config.installScript!.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    fs.writeFileSync(scriptFile, normalizedScript, 'utf8');

    const envArray = Object.entries(config.environment).map(([k, v]) => `${k}=${v}`);

    const createInstallContainer = (shell: string) => d.createContainer({
      name: installName,
      Image: installImage,
      Cmd: [shell, '/mnt/server/.wings_install.sh'],
      Env: envArray,
      User: '0',
      WorkingDir: '/mnt/server',
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Binds: [`${dataPath}:/mnt/server`],
        NetworkMode: 'host',
        AutoRemove: false,
      },
    });

    // Most egg install scripts are written for bash, so prefer it when present.
    // But plenty of minimal/SteamCMD-style images (common for non-Minecraft
    // eggs) only ship /bin/sh — fall back instead of hard-failing the install.
    let container = await createInstallContainer('/bin/bash');
    try {
      await container.start();
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('/bin/bash') && msg.includes('no such file or directory')) {
        this.sendConsole(uuid, '[Wings] /bin/bash not found in install image, retrying with /bin/sh...');
        await container.remove({ force: true }).catch(() => {});
        container = await createInstallContainer('/bin/sh');
        await container.start();
      } else {
        throw err;
      }
    }

    // Stream install output to console
    await new Promise<void>((resolve) => {
      container.logs({ stdout: true, stderr: true, follow: true, timestamps: false, tail: 0 },
        (err: Error | null, stream?: NodeJS.ReadableStream) => {
          if (err || !stream) { resolve(); return; }
          let buf = '';
          stream.on('data', (chunk: Buffer) => {
            const data = chunk.length > 8 ? chunk.slice(8).toString('utf8') : chunk.toString('utf8');
            buf += data;
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            lines.forEach(line => { if (line.trim()) this.sendConsole(uuid, `[Install] ${line}`); });
          });
          stream.on('end', resolve);
          stream.on('error', () => resolve());
        });
    });

    const result = await (container as unknown as { wait(): Promise<{ StatusCode: number }> }).wait();
    await container.remove({ force: true }).catch(() => {});
    try { fs.unlinkSync(scriptFile); } catch { /* ignore */ }

    if (result.StatusCode !== 0) {
      throw new Error(`Install script exited with code ${result.StatusCode}`);
    }
  }

  private setStatus(uuid: string, status: ServerStatus) {
    const server = this.servers.get(uuid);
    if (!server) return;
    server.status = status;
    if (status === 'offline') {
      this.playerSessions.delete(uuid);
      const hist = this.allPlayerHistory.get(uuid);
      if (hist) for (const e of hist.values()) e.online = false;
    }
    this.emit('status', { uuid, status });
    this.io?.to(`server:${uuid}`).emit('server:status', { uuid, state: status });
    panelClient.reportStatus(uuid, status).catch(() => { /* best effort */ });
  }

  getOnlinePlayers(uuid: string): { name: string; uuid: string }[] {
    const map = this.playerSessions.get(uuid) ?? new Map();
    return [...map.entries()].map(([name, playerUuid]) => ({ name, uuid: playerUuid }));
  }

  getAllPlayerHistory(serverUuid: string): PlayerHistoryEntry[] {
    if (!this.allPlayerHistory.has(serverUuid)) {
      this.allPlayerHistory.set(serverUuid, new Map());
    }
    const hist = this.allPlayerHistory.get(serverUuid)!;
    const onlineMap = this.playerSessions.get(serverUuid) ?? new Map<string, string>();
    // Ensure every currently-online player is in history with correct online flag
    // This handles Wings restarts where session was already in progress
    for (const [name, playerUuid] of onlineMap) {
      const e = hist.get(name);
      if (e) {
        e.online = true;
        if (!e.uuid && playerUuid) e.uuid = playerUuid;
      } else {
        hist.set(name, { name, uuid: playerUuid, firstSeen: new Date(0), lastSeen: new Date(), joinCount: 0, online: true });
      }
    }
    return [...hist.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  }

  getLogBuffer(uuid: string): string[] {
    return this.servers.get(uuid)?.logBuffer ?? [];
  }

  private trackPlayerEvents(uuid: string, line: string) {
    if (!this.allPlayerHistory.has(uuid)) this.allPlayerHistory.set(uuid, new Map());
    const hist = this.allPlayerHistory.get(uuid)!;

    const uuidMatch = line.match(/UUID of player (\S+) is ([0-9a-f-]{36})/i);
    if (uuidMatch) {
      const [, name, playerUuid] = uuidMatch;
      if (!this.playerSessions.has(uuid)) this.playerSessions.set(uuid, new Map());
      this.playerSessions.get(uuid)!.set(name, playerUuid);
      const e = hist.get(name);
      if (e) e.uuid = playerUuid;
    }

    const joinMatch = line.match(/\]: (\w[\w ]*?) joined the game\s*$/);
    if (joinMatch) {
      const name = joinMatch[1];
      if (!this.playerSessions.has(uuid)) this.playerSessions.set(uuid, new Map());
      const map = this.playerSessions.get(uuid)!;
      if (!map.has(name)) map.set(name, '');
      const existing = hist.get(name);
      if (existing) {
        existing.lastSeen = new Date(); existing.joinCount++; existing.online = true;
      } else {
        hist.set(name, { name, uuid: map.get(name) || '', firstSeen: new Date(), lastSeen: new Date(), joinCount: 1, online: true });
      }
      const players = this.getOnlinePlayers(uuid);
      this.io?.to(`server:${uuid}`).emit('server:players', { uuid, players });
    }

    const leaveMatch = line.match(/\]: (\w[\w ]*?) left the game\s*$/);
    if (leaveMatch) {
      const name = leaveMatch[1];
      this.playerSessions.get(uuid)?.delete(name);
      const e = hist.get(name);
      if (e) { e.online = false; e.lastSeen = new Date(); }
      const players = this.getOnlinePlayers(uuid);
      this.io?.to(`server:${uuid}`).emit('server:players', { uuid, players });
    }

    // Bedrock player connect/disconnect
    const bedrockConnectMatch = line.match(/Player connected: (\S+),/);
    if (bedrockConnectMatch) {
      const name = bedrockConnectMatch[1];
      if (!this.playerSessions.has(uuid)) this.playerSessions.set(uuid, new Map());
      const map = this.playerSessions.get(uuid)!;
      if (!map.has(name)) map.set(name, '');
      const existing = hist.get(name);
      if (existing) {
        existing.lastSeen = new Date(); existing.joinCount++; existing.online = true;
      } else {
        hist.set(name, { name, uuid: '', firstSeen: new Date(), lastSeen: new Date(), joinCount: 1, online: true });
      }
      const players = this.getOnlinePlayers(uuid);
      this.io?.to(`server:${uuid}`).emit('server:players', { uuid, players });
    }

    const bedrockDisconnectMatch = line.match(/Player disconnected: (\S+),/);
    if (bedrockDisconnectMatch) {
      const name = bedrockDisconnectMatch[1];
      this.playerSessions.get(uuid)?.delete(name);
      const e = hist.get(name);
      if (e) { e.online = false; e.lastSeen = new Date(); }
      const players = this.getOnlinePlayers(uuid);
      this.io?.to(`server:${uuid}`).emit('server:players', { uuid, players });
    }

    // Parse "list" command response to seed online players on Wings startup/reattach
    const listMatch = line.match(/There are \d+ of a max of \d+ players online:\s*(.+)$/);
    if (listMatch && listMatch[1].trim()) {
      const names = listMatch[1].split(',').map(n => n.trim()).filter(n => n);
      if (!this.playerSessions.has(uuid)) this.playerSessions.set(uuid, new Map());
      const map = this.playerSessions.get(uuid)!;
      for (const name of names) {
        if (!map.has(name)) map.set(name, '');
        if (!hist.has(name)) {
          hist.set(name, { name, uuid: '', firstSeen: new Date(0), lastSeen: new Date(), joinCount: 0, online: true });
        } else {
          hist.get(name)!.online = true;
        }
      }
      const players = this.getOnlinePlayers(uuid);
      this.io?.to(`server:${uuid}`).emit('server:players', { uuid, players });
    }
  }

  private sendAlert(uuid: string, severity: 'warning' | 'critical', message: string) {
    this.io?.to(`server:${uuid}`).emit('server:alert', { uuid, severity, message, timestamp: Date.now() });
    this.sendConsole(uuid, `[Kretase] ⚠ ${message}`);
  }

  private trackSuspiciousActivity(uuid: string, line: string) {
    const commandMatch = line.match(/\]: (\w[\w ]*?) issued server command: \/(\S+)/);
    if (!commandMatch) return;
    const [, player, command] = commandMatch;
    const baseCommand = command.toLowerCase();

    if (SENSITIVE_COMMANDS.includes(baseCommand)) {
      this.sendAlert(uuid, 'warning', `${player} ran a sensitive command: /${command}`);
    }

    const now = Date.now();
    if (!this.commandTimestamps.has(uuid)) this.commandTimestamps.set(uuid, new Map());
    const perPlayer = this.commandTimestamps.get(uuid)!;
    const recent = (perPlayer.get(player) ?? []).filter((t) => now - t < COMMAND_SPAM_WINDOW_MS);
    recent.push(now);
    perPlayer.set(player, recent);

    if (recent.length === COMMAND_SPAM_THRESHOLD) {
      this.sendAlert(uuid, 'critical', `${player} ran ${recent.length} commands in ${COMMAND_SPAM_WINDOW_MS / 1000}s — possible macro/script abuse`);
    }
  }

  private sendConsole(uuid: string, line: string) {
    const server = this.servers.get(uuid);
    if (server) {
      server.logBuffer.push(line);
      if (server.logBuffer.length > MAX_LOG_BUFFER) server.logBuffer.shift();
    }
    this.io?.to(`server:${uuid}`).emit('server:console', { uuid, data: line });
    this.emit('console', { uuid, line });
    this.trackPlayerEvents(uuid, line);
    this.trackSuspiciousActivity(uuid, line);
  }

  private attachLogStream(uuid: string, containerId: string) {
    const d = getDocker();
    const container = d.getContainer(containerId);

    container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      timestamps: false,
      tail: 50,
    }, (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) return;

      const server = this.servers.get(uuid);
      if (server) server.logStream = stream;

      let buffer = '';
      stream.on('data', (chunk: Buffer) => {
        // Containers with Tty:true produce raw output (no 8-byte Docker multiplexer
        // frame header). Non-TTY containers do have the header. Detect by checking
        // the Docker frame magic: byte 0 = 0x01 (stdout) or 0x02 (stderr), bytes
        // 1-3 = 0x00 (reserved).
        const isMultiplexed =
          chunk.length > 8 &&
          (chunk[0] === 0x01 || chunk[0] === 0x02) &&
          chunk[1] === 0x00 && chunk[2] === 0x00 && chunk[3] === 0x00;
        const data = isMultiplexed
          ? chunk.slice(8).toString('utf8')
          : chunk.toString('utf8');
        buffer += data;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(line => {
          const clean = stripAnsi(line);
          if (clean.trim()) this.sendConsole(uuid, clean);
        });
      });

      stream.on('end', () => {
        // Flush any remaining buffered output
        const clean = stripAnsi(buffer);
        if (clean.trim()) {
          this.sendConsole(uuid, clean);
          buffer = '';
        }
        const server = this.servers.get(uuid);
        // Only a container that was 'running' with nobody having called
        // stopServer() (which flips status to 'stopping' before touching
        // the container) counts as an unexpected exit — a normal stop
        // reaches this same 'end' event through the exact same code path.
        const wasUnexpectedExit = server?.status === 'running';
        if (server?.status === 'running' || server?.status === 'stopping') {
          this.setStatus(uuid, 'offline');
        }
        if (wasUnexpectedExit) this.handleCrash(uuid);
      });
    });
  }

  private handleCrash(uuid: string) {
    const server = this.servers.get(uuid);
    if (!server) return;
    this.sendConsole(uuid, '[Wings] Server process exited unexpectedly (crash detected).');
    // Distinct from the console line above — this is what the panel listens
    // for to record a real, queryable crash event (used by the health score
    // and eventually alerting), rather than trying to string-match console
    // output for something this important.
    this.io?.to(`server:${uuid}`).emit('server:crash', { uuid, timestamp: Date.now() });
    this.emit('crash', { uuid });

    if (server.config.crashDetectionEnabled === false) return;

    const now = Date.now();
    const recent = (this.crashTimestamps.get(uuid) ?? []).filter(t => now - t < CRASH_WINDOW_MS);
    recent.push(now);
    this.crashTimestamps.set(uuid, recent);

    if (recent.length > MAX_CRASHES_IN_WINDOW) {
      this.sendConsole(
        uuid,
        `[Wings] Crashed ${recent.length} times in the last ${CRASH_WINDOW_MS / 60000} minutes — auto-restart disabled to avoid a boot loop. Start it manually once the issue is fixed.`
      );
      return;
    }

    this.sendConsole(uuid, `[Wings] Restarting automatically in ${CRASH_RESTART_DELAY_MS / 1000}s (attempt ${recent.length}/${MAX_CRASHES_IN_WINDOW})...`);
    setTimeout(() => {
      this.startServer(uuid).catch(err => logger.error(`Auto-restart failed for ${uuid}: ${(err as Error).message}`));
    }, CRASH_RESTART_DELAY_MS);
  }

  private attachStdinStream(uuid: string, containerId: string): Promise<void> {
    const d = getDocker();
    const container = d.getContainer(containerId);

    return new Promise((resolve) => {
      container.attach(
        { stream: true, stdin: true, stdout: false, stderr: false },
        (err: Error | null, stream?: NodeJS.ReadWriteStream) => {
          if (err || !stream) {
            logger.warn(`stdin attach failed for ${uuid}: ${err?.message ?? 'no stream'}`);
            resolve();
            return;
          }
          const srv = this.servers.get(uuid);
          if (srv) srv.stdinStream = stream;

          const cleanup = () => {
            const s = this.servers.get(uuid);
            if (s) s.stdinStream = undefined;
          };
          stream.on('error', cleanup);
          stream.on('close', cleanup);
          stream.on('end', cleanup);
          resolve();
        }
      );
    });
  }

  private startStatsInterval(uuid: string) {
    const server = this.servers.get(uuid);
    if (!server) return;

    clearInterval(server.statsInterval);
    server.statsInterval = setInterval(async () => {
      if (server.status !== 'running') return;
      const resources = await this.getResources(uuid);
      this.io?.to(`server:${uuid}`).emit('server:stats', { uuid, ...resources });
    }, 2000);
  }

  async deleteServer(uuid: string): Promise<void> {
    if (this.servers.has(uuid)) {
      await this.stopServer(uuid, true).catch((err) =>
        logger.warn(`Error stopping ${uuid} during delete (continuing): ${(err as Error).message}`)
      );
      this.servers.delete(uuid);
    } else {
      // Not tracked in memory — e.g. Wings restarted since this server was
      // loaded, or the panel is cleaning up a server it already forgot
      // about. Still remove any container with this server's deterministic
      // name directly, rather than silently leaving it running forever and
      // squatting on its port.
      try {
        const d = getDocker();
        const containerName = `mc_${uuid}`;
        const existing = await d.listContainers({ all: true, filters: { name: [containerName] } });
        if (existing.length > 0) {
          await d.getContainer(existing[0].Id).remove({ force: true }).catch(() => { /* best-effort */ });
        }
      } catch (err) {
        logger.warn(`Error force-removing untracked container for ${uuid}: ${(err as Error).message}`);
      }
    }

    const cfg = getConfig();
    const dataPath = path.join(cfg.system.data, uuid);
    fs.rmSync(dataPath, { recursive: true, force: true });

    logger.info(`Server deleted: ${uuid}`);
  }

  getServerList(): string[] {
    return Array.from(this.servers.keys());
  }
}

async function getDirSize(dirPath: string): Promise<number> {
  if (!fs.existsSync(dirPath)) return 0;
  let size = 0;
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of items) {
    const p = path.join(dirPath, item.name);
    if (item.isDirectory()) size += await getDirSize(p);
    else size += fs.statSync(p).size;
  }
  return size;
}

export const serverManager = new ServerManager();
