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

  async startServer(uuid: string): Promise<void> {
    const server = this.servers.get(uuid);
    if (!server) throw new Error(`Server ${uuid} not found`);
    if (server.status === 'running' || server.status === 'starting' || server.status === 'stopping') return;

    this.setStatus(uuid, 'starting');
    const cfg = getConfig();
    const dataPath = path.join(cfg.system.data, uuid);
    fs.mkdirSync(dataPath, { recursive: true });

    try {
      const { config } = server;
      const isBedrock = this.isBedrockServer(uuid);

      if (!isBedrock) {
        // Auto-accept Minecraft Java EULA
        const eulaPath = path.join(dataPath, 'eula.txt');
        if (!fs.existsSync(eulaPath)) {
          fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
        } else {
          const eulaContent = fs.readFileSync(eulaPath, 'utf8');
          if (eulaContent.includes('eula=false')) {
            fs.writeFileSync(eulaPath, eulaContent.replace('eula=false', 'eula=true'), 'utf8');
          }
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
            '#Minecraft server properties — optimized defaults by MC Manage Panel',
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
    const config = server?.config ?? externalConfig;
    if (!config) throw new Error('Server not found — provide config in request body');

    // Load into memory if not already there so status updates work
    if (!server && externalConfig) {
      await this.loadServer(externalConfig).catch(() => {});
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
    const scriptFile = path.join(dataPath, '.wings_install.sh');
    fs.writeFileSync(scriptFile, config.installScript!, 'utf8');

    const envArray = Object.entries(config.environment).map(([k, v]) => `${k}=${v}`);

    const container = await d.createContainer({
      name: installName,
      Image: installImage,
      Cmd: ['/bin/bash', '/mnt/server/.wings_install.sh'],
      Env: envArray,
      User: '0',
      WorkingDir: '/mnt/server',
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Binds: [`${dataPath}:/mnt/server`],
        NetworkMode: 'bridge',
        Dns: ['8.8.8.8', '1.1.1.1'],
        AutoRemove: false,
      },
    });

    await container.start();

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

  private sendConsole(uuid: string, line: string) {
    const server = this.servers.get(uuid);
    if (server) {
      server.logBuffer.push(line);
      if (server.logBuffer.length > MAX_LOG_BUFFER) server.logBuffer.shift();
    }
    this.io?.to(`server:${uuid}`).emit('server:console', { uuid, data: line });
    this.emit('console', { uuid, line });
    this.trackPlayerEvents(uuid, line);
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
          if (line.trim()) this.sendConsole(uuid, line);
        });
      });

      stream.on('end', () => {
        // Flush any remaining buffered output
        if (buffer.trim()) {
          this.sendConsole(uuid, buffer);
          buffer = '';
        }
        const server = this.servers.get(uuid);
        if (server?.status === 'running' || server?.status === 'stopping') {
          this.setStatus(uuid, 'offline');
        }
      });
    });
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
    await this.stopServer(uuid, true);
    this.servers.delete(uuid);

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
