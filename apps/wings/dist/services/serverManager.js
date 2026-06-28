"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverManager = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const events_1 = require("events");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const dockerService_1 = require("./dockerService");
const panelClient_1 = require("./panelClient");
const MAX_LOG_BUFFER = 500;
class ServerManager extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.servers = new Map();
        this.playerSessions = new Map(); // serverUuid -> Map<playerName, playerUuid>
        this.allPlayerHistory = new Map(); // serverUuid -> Map<playerName, entry>
    }
    setSocketServer(io) {
        this.io = io;
    }
    isBedrockServer(uuid) {
        const env = this.servers.get(uuid)?.config.environment ?? {};
        return env['SERVER_TYPE'] === 'BEDROCK';
    }
    async loadServer(config) {
        const existing = this.servers.get(config.uuid);
        const cfg = (0, config_1.getConfig)();
        const dataPath = path_1.default.join(cfg.system.data, config.uuid);
        fs_1.default.mkdirSync(dataPath, { recursive: true });
        // Check if container already running
        const containerId = await (0, dockerService_1.containerExists)(config.uuid);
        let status = 'offline';
        if (containerId) {
            try {
                const d = (0, dockerService_1.getDocker)();
                const container = d.getContainer(containerId);
                const info = await container.inspect();
                if (info.State.Running) {
                    status = 'running';
                }
            }
            catch { /* container gone */ }
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
            setTimeout(() => this.sendCommand(config.uuid, 'list').catch(() => { }), 3000);
        }
        logger_1.logger.info(`Server loaded: ${config.uuid} (${status})`);
    }
    async startServer(uuid) {
        const server = this.servers.get(uuid);
        if (!server)
            throw new Error(`Server ${uuid} not found`);
        if (server.status === 'running' || server.status === 'starting' || server.status === 'stopping')
            return;
        this.setStatus(uuid, 'starting');
        const cfg = (0, config_1.getConfig)();
        const dataPath = path_1.default.join(cfg.system.data, uuid);
        fs_1.default.mkdirSync(dataPath, { recursive: true });
        try {
            const { config } = server;
            const isBedrock = this.isBedrockServer(uuid);
            if (!isBedrock) {
                // Auto-accept Minecraft Java EULA
                const eulaPath = path_1.default.join(dataPath, 'eula.txt');
                if (!fs_1.default.existsSync(eulaPath)) {
                    fs_1.default.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
                }
                else {
                    const eulaContent = fs_1.default.readFileSync(eulaPath, 'utf8');
                    if (eulaContent.includes('eula=false')) {
                        fs_1.default.writeFileSync(eulaPath, eulaContent.replace('eula=false', 'eula=true'), 'utf8');
                    }
                }
            }
            // Substitute {{VAR}} placeholders in invocation with environment values.
            // Fall back to sensible defaults for critical JVM variables so a missing
            // SERVER_MEMORY in env never produces a broken -XmsM flag.
            const invocation = config.invocation.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
                const k = key.trim();
                if (k === 'SERVER_MEMORY')
                    return config.environment[k] || String(config.build.memory_limit);
                if (k === 'SERVER_JARFILE')
                    return config.environment[k] || 'server.jar';
                return config.environment[k] ?? '';
            });
            // Make the data directory world-writable BEFORE install so the install
            // container (uid 1000) can write files into it.
            try {
                fs_1.default.chmodSync(dataPath, 0o777);
            }
            catch { /* non-fatal */ }
            // Pull image if needed
            if (!await (0, dockerService_1.imageExists)(config.image)) {
                this.sendConsole(uuid, `[Wings] Pulling image ${config.image}...`);
                await (0, dockerService_1.pullImage)(config.image);
            }
            // Run install script on first start (when server binary/jar doesn't exist)
            const isBedrockBinary = isBedrock;
            const jarFile = config.environment['SERVER_JARFILE'] || 'server.jar';
            const firstStartFile = isBedrockBinary ? 'bedrock_server' : jarFile;
            const isFirstStart = !fs_1.default.existsSync(path_1.default.join(dataPath, firstStartFile));
            if (isFirstStart && config.installScript) {
                this.sendConsole(uuid, '[Wings] Running install script...');
                try {
                    await this.runInstallScript(uuid, config, dataPath);
                    this.sendConsole(uuid, '[Wings] Install complete.');
                }
                catch (err) {
                    this.sendConsole(uuid, `[Wings] Install failed: ${err.message}`);
                    this.setStatus(uuid, 'offline');
                    throw err;
                }
            }
            if (!isBedrock) {
                // Pre-create subdirectories that server software needs (e.g. Paper's cache/).
                // chmod 777 so any container uid can write without requiring a root chown.
                for (const dir of ['cache', 'logs', 'config']) {
                    const dirPath = path_1.default.join(dataPath, dir);
                    fs_1.default.mkdirSync(dirPath, { recursive: true });
                    try {
                        fs_1.default.chmodSync(dirPath, 0o777);
                    }
                    catch { /* non-fatal */ }
                }
                this.sendConsole(uuid, '[Wings] Prepared server directories.');
            }
            if (!isBedrock) {
                // Write optimized Java server.properties on first start (before Paper generates defaults).
                // view-distance=7 and simulation-distance=4 reduce chunk loading pressure by ~50%
                // vs the Paper default of 10, eliminating the main source of TPS lag.
                const propsFile = path_1.default.join(dataPath, 'server.properties');
                if (!fs_1.default.existsSync(propsFile)) {
                    const serverPort = parseInt(config.environment['SERVER_PORT'] || config.environment['PORT'] || '25565', 10);
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
                        fs_1.default.writeFileSync(propsFile, props, 'utf8');
                        this.sendConsole(uuid, '[Wings] Wrote optimized server.properties (view-distance=7, simulation-distance=4)');
                    }
                    catch { /* non-fatal — Paper will create its own */ }
                }
                else {
                    // Patch view-distance and simulation-distance in existing server.properties
                    // if they are still at the heavy Paper default of 10.
                    try {
                        let props = fs_1.default.readFileSync(propsFile, 'utf8');
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
                            fs_1.default.writeFileSync(propsFile, props, 'utf8');
                            this.sendConsole(uuid, '[Wings] Patched server.properties: view-distance=7, simulation-distance=4');
                        }
                    }
                    catch { /* non-fatal */ }
                }
            }
            else {
                // Write Bedrock server.properties on first start
                const bedrockPropsFile = path_1.default.join(dataPath, 'server.properties');
                if (!fs_1.default.existsSync(bedrockPropsFile)) {
                    const serverPort = parseInt(config.environment['SERVER_PORT'] || config.environment['PORT'] || '19132', 10);
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
                        fs_1.default.writeFileSync(bedrockPropsFile, bedrockProps, 'utf8');
                        this.sendConsole(uuid, '[Wings] Wrote Bedrock server.properties');
                    }
                    catch { /* non-fatal */ }
                }
            }
            // Ensure all files in the volume are owned by UID 1000 so the container
            // user can write them (Wings writes eula.txt etc. as the mcwings OS user,
            // which has a different UID). This also fixes server.properties being
            // unwritable on subsequent starts.
            // BDS runs as root (uid 0) so we can skip volume permissions for Bedrock.
            if (!isBedrock) {
                try {
                    await (0, dockerService_1.ensureVolumePermissions)(config.image, dataPath);
                }
                catch (err) {
                    logger_1.logger.warn(`ensureVolumePermissions failed (non-fatal): ${err.message}`);
                }
            }
            // Remove old container if exists
            const existingId = await (0, dockerService_1.containerExists)(uuid);
            if (existingId) {
                try {
                    await (0, dockerService_1.getDocker)().getContainer(existingId).remove({ force: true });
                }
                catch { /* ignore */ }
            }
            // Create new container
            this.sendConsole(uuid, '[Wings] Creating container...');
            const container = await (0, dockerService_1.createContainer)(uuid, config.image, invocation, config.environment, {
                memory: config.build.memory_limit,
                swap: config.build.swap,
                cpu: config.build.cpu_limit,
                disk: config.build.disk_space,
                io: config.build.io_weight,
                oomDisabled: config.build.oom_disabled,
            }, dataPath);
            await container.start();
            server.containerId = container.id;
            server.startedAt = new Date();
            this.setStatus(uuid, 'running');
            // Discard any lingering stream from the previous run before attaching fresh
            if (server.logStream) {
                try {
                    server.logStream.destroy?.();
                }
                catch { /* ignore */ }
                server.logStream = undefined;
            }
            this.attachLogStream(uuid, container.id);
            this.startStatsInterval(uuid);
            this.attachStdinStream(uuid, container.id);
            logger_1.logger.info(`Server started: ${uuid}`);
        }
        catch (err) {
            logger_1.logger.error(`Failed to start server ${uuid}:`, err);
            this.setStatus(uuid, 'offline');
            this.sendConsole(uuid, `[Wings] Failed to start: ${err.message}`);
            throw err;
        }
    }
    async stopServer(uuid, kill = false) {
        const server = this.servers.get(uuid);
        if (!server)
            throw new Error(`Server ${uuid} not found`);
        if (server.status === 'offline' || server.status === 'stopping')
            return;
        this.setStatus(uuid, 'stopping');
        clearInterval(server.statsInterval);
        if (server.containerId) {
            try {
                const d = (0, dockerService_1.getDocker)();
                const container = d.getContainer(server.containerId);
                if (kill) {
                    await container.kill();
                }
                else {
                    const stopCmd = (server.config.environment['MC_STOP_COMMAND'] || 'stop').replace(/"/g, '\\"');
                    // Use the persistent stdinStream first — most reliable path to Minecraft stdin
                    if (server.stdinStream) {
                        try {
                            server.stdinStream.write(stopCmd + '\n');
                            await new Promise(r => setTimeout(r, 500));
                        }
                        catch { /* stream may be closing */ }
                    }
                    else {
                        // Fall back to exec writing to PID 1's stdin fd
                        try {
                            const exec = await container.exec({
                                AttachStdin: true,
                                AttachStdout: false,
                                AttachStderr: false,
                                Cmd: ['/bin/sh', '-c', `echo "${stopCmd}" > /proc/1/fd/0`],
                            });
                            await exec.start({ hijack: true, stdin: true });
                        }
                        catch {
                            try {
                                const stream = await container.attach({ stream: true, stdin: true, stdout: false, stderr: false });
                                stream.write(stopCmd + '\n');
                                stream.end();
                            }
                            catch { /* best effort */ }
                        }
                    }
                    await new Promise(r => setTimeout(r, 8000));
                    try {
                        await container.stop({ t: 15 });
                    }
                    catch { /* may already be stopped */ }
                }
                await container.remove({ force: true }).catch(() => { });
            }
            catch (err) {
                logger_1.logger.error(`Error stopping container for ${uuid}:`, err);
            }
        }
        // Destroy logStream only after the container is gone so shutdown logs flow through
        if (server.logStream) {
            try {
                server.logStream.destroy?.();
            }
            catch { /* ignore */ }
            server.logStream = undefined;
        }
        // Clean up streams after the stop command was sent and container is gone
        if (server.stdinStream) {
            try {
                server.stdinStream.destroy?.();
            }
            catch { /* ignore */ }
            server.stdinStream = undefined;
        }
        server.containerId = undefined;
        server.startedAt = undefined;
        this.setStatus(uuid, 'offline');
        logger_1.logger.info(`Server stopped: ${uuid}`);
    }
    async restartServer(uuid) {
        const server = this.servers.get(uuid);
        if (!server)
            return;
        // Prevent double-restart: if already stopping or offline nothing useful to do
        if (server.status === 'stopping')
            return;
        await this.stopServer(uuid);
        await new Promise(r => setTimeout(r, 1000));
        await this.startServer(uuid);
    }
    async killServer(uuid) {
        await this.stopServer(uuid, true);
    }
    async sendCommand(uuid, command) {
        const server = this.servers.get(uuid);
        if (!server || server.status !== 'running' || !server.containerId)
            return;
        // Prefer the persistent PTY stdin stream (attached when container started)
        if (server.stdinStream) {
            try {
                server.stdinStream.write(command + '\n');
                return;
            }
            catch {
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
            }
            catch {
                const srv = this.servers.get(uuid);
                if (srv)
                    srv.stdinStream = undefined;
            }
        }
        // Last resort: docker exec to find the Java process and write to its stdin fd
        try {
            const d = (0, dockerService_1.getDocker)();
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
        }
        catch (err) {
            logger_1.logger.error(`Failed to send command to ${uuid}:`, err);
        }
    }
    getStatus(uuid) {
        return this.servers.get(uuid)?.status || 'offline';
    }
    getServerEnvironment(uuid) {
        return this.servers.get(uuid)?.config.environment ?? {};
    }
    async getResources(uuid) {
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
        const stats = await (0, dockerService_1.getContainerStats)(server.containerId).catch(() => ({
            cpu: 0, memoryBytes: 0, memoryLimitBytes: 0, networkRx: 0, networkTx: 0,
        }));
        const uptime = server.startedAt
            ? Math.floor((Date.now() - server.startedAt.getTime()) / 1000)
            : 0;
        const dataPath = path_1.default.join((0, config_1.getConfig)().system.data, uuid);
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
    async reinstallServer(uuid, externalConfig) {
        const server = this.servers.get(uuid);
        const config = server?.config ?? externalConfig;
        if (!config)
            throw new Error('Server not found — provide config in request body');
        // Load into memory if not already there so status updates work
        if (!server && externalConfig) {
            await this.loadServer(externalConfig).catch(() => { });
        }
        if (server?.status && server.status !== 'offline') {
            await this.stopServer(uuid).catch(() => { });
            await new Promise(r => setTimeout(r, 4000));
        }
        const cfg = (0, config_1.getConfig)();
        const dataPath = path_1.default.join(cfg.system.data, uuid);
        if (fs_1.default.existsSync(dataPath)) {
            for (const f of fs_1.default.readdirSync(dataPath)) {
                fs_1.default.rmSync(path_1.default.join(dataPath, f), { recursive: true, force: true });
            }
        }
        else {
            fs_1.default.mkdirSync(dataPath, { recursive: true });
        }
        this.setStatus(uuid, 'installing');
        this.sendConsole(uuid, '[Wings] Reinstalling server...');
        if (config.installScript) {
            await this.runInstallScript(uuid, config, dataPath);
        }
        this.setStatus(uuid, 'offline');
        this.sendConsole(uuid, '[Wings] Reinstall complete. Start the server to launch.');
    }
    async runInstallScript(uuid, config, dataPath) {
        const d = (0, dockerService_1.getDocker)();
        const installName = `mc_install_${uuid}`;
        // Use scriptContainer if provided, otherwise fall back to server image
        const installImage = config.scriptContainer || config.image;
        if (!await (0, dockerService_1.imageExists)(installImage)) {
            this.sendConsole(uuid, `[Wings] Pulling image ${installImage}...`);
            await (0, dockerService_1.pullImage)(installImage);
        }
        // Remove stale install container
        try {
            const existing = await d.listContainers({ all: true, filters: { name: [installName] } });
            if (existing.length > 0)
                await d.getContainer(existing[0].Id).remove({ force: true });
        }
        catch { /* ignore */ }
        // Write install script to data dir. Volume ownership is handled separately by
        // ensureVolumePermissions(), so the install runs as uid 1000 on a writable dir.
        const scriptFile = path_1.default.join(dataPath, '.wings_install.sh');
        fs_1.default.writeFileSync(scriptFile, config.installScript, 'utf8');
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
                NetworkMode: 'host',
                AutoRemove: false,
            },
        });
        await container.start();
        // Stream install output to console
        await new Promise((resolve) => {
            container.logs({ stdout: true, stderr: true, follow: true, timestamps: false, tail: 0 }, (err, stream) => {
                if (err || !stream) {
                    resolve();
                    return;
                }
                let buf = '';
                stream.on('data', (chunk) => {
                    const data = chunk.length > 8 ? chunk.slice(8).toString('utf8') : chunk.toString('utf8');
                    buf += data;
                    const lines = buf.split('\n');
                    buf = lines.pop() || '';
                    lines.forEach(line => { if (line.trim())
                        this.sendConsole(uuid, `[Install] ${line}`); });
                });
                stream.on('end', resolve);
                stream.on('error', () => resolve());
            });
        });
        const result = await container.wait();
        await container.remove({ force: true }).catch(() => { });
        try {
            fs_1.default.unlinkSync(scriptFile);
        }
        catch { /* ignore */ }
        if (result.StatusCode !== 0) {
            throw new Error(`Install script exited with code ${result.StatusCode}`);
        }
    }
    setStatus(uuid, status) {
        const server = this.servers.get(uuid);
        if (!server)
            return;
        server.status = status;
        if (status === 'offline') {
            this.playerSessions.delete(uuid);
            const hist = this.allPlayerHistory.get(uuid);
            if (hist)
                for (const e of hist.values())
                    e.online = false;
        }
        this.emit('status', { uuid, status });
        this.io?.to(`server:${uuid}`).emit('server:status', { uuid, state: status });
        panelClient_1.panelClient.reportStatus(uuid, status).catch(() => { });
    }
    getOnlinePlayers(uuid) {
        const map = this.playerSessions.get(uuid) ?? new Map();
        return [...map.entries()].map(([name, playerUuid]) => ({ name, uuid: playerUuid }));
    }
    getAllPlayerHistory(serverUuid) {
        if (!this.allPlayerHistory.has(serverUuid)) {
            this.allPlayerHistory.set(serverUuid, new Map());
        }
        const hist = this.allPlayerHistory.get(serverUuid);
        const onlineMap = this.playerSessions.get(serverUuid) ?? new Map();
        // Ensure every currently-online player is in history with correct online flag
        // This handles Wings restarts where session was already in progress
        for (const [name, playerUuid] of onlineMap) {
            const e = hist.get(name);
            if (e) {
                e.online = true;
                if (!e.uuid && playerUuid)
                    e.uuid = playerUuid;
            }
            else {
                hist.set(name, { name, uuid: playerUuid, firstSeen: new Date(0), lastSeen: new Date(), joinCount: 0, online: true });
            }
        }
        return [...hist.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
    }
    getLogBuffer(uuid) {
        return this.servers.get(uuid)?.logBuffer ?? [];
    }
    trackPlayerEvents(uuid, line) {
        if (!this.allPlayerHistory.has(uuid))
            this.allPlayerHistory.set(uuid, new Map());
        const hist = this.allPlayerHistory.get(uuid);
        const uuidMatch = line.match(/UUID of player (\S+) is ([0-9a-f-]{36})/i);
        if (uuidMatch) {
            const [, name, playerUuid] = uuidMatch;
            if (!this.playerSessions.has(uuid))
                this.playerSessions.set(uuid, new Map());
            this.playerSessions.get(uuid).set(name, playerUuid);
            const e = hist.get(name);
            if (e)
                e.uuid = playerUuid;
        }
        const joinMatch = line.match(/\]: (\w[\w ]*?) joined the game\s*$/);
        if (joinMatch) {
            const name = joinMatch[1];
            if (!this.playerSessions.has(uuid))
                this.playerSessions.set(uuid, new Map());
            const map = this.playerSessions.get(uuid);
            if (!map.has(name))
                map.set(name, '');
            const existing = hist.get(name);
            if (existing) {
                existing.lastSeen = new Date();
                existing.joinCount++;
                existing.online = true;
            }
            else {
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
            if (e) {
                e.online = false;
                e.lastSeen = new Date();
            }
            const players = this.getOnlinePlayers(uuid);
            this.io?.to(`server:${uuid}`).emit('server:players', { uuid, players });
        }
        // Bedrock player connect/disconnect
        const bedrockConnectMatch = line.match(/Player connected: (\S+),/);
        if (bedrockConnectMatch) {
            const name = bedrockConnectMatch[1];
            if (!this.playerSessions.has(uuid))
                this.playerSessions.set(uuid, new Map());
            const map = this.playerSessions.get(uuid);
            if (!map.has(name))
                map.set(name, '');
            const existing = hist.get(name);
            if (existing) {
                existing.lastSeen = new Date();
                existing.joinCount++;
                existing.online = true;
            }
            else {
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
            if (e) {
                e.online = false;
                e.lastSeen = new Date();
            }
            const players = this.getOnlinePlayers(uuid);
            this.io?.to(`server:${uuid}`).emit('server:players', { uuid, players });
        }
        // Parse "list" command response to seed online players on Wings startup/reattach
        const listMatch = line.match(/There are \d+ of a max of \d+ players online:\s*(.+)$/);
        if (listMatch && listMatch[1].trim()) {
            const names = listMatch[1].split(',').map(n => n.trim()).filter(n => n);
            if (!this.playerSessions.has(uuid))
                this.playerSessions.set(uuid, new Map());
            const map = this.playerSessions.get(uuid);
            for (const name of names) {
                if (!map.has(name))
                    map.set(name, '');
                if (!hist.has(name)) {
                    hist.set(name, { name, uuid: '', firstSeen: new Date(0), lastSeen: new Date(), joinCount: 0, online: true });
                }
                else {
                    hist.get(name).online = true;
                }
            }
            const players = this.getOnlinePlayers(uuid);
            this.io?.to(`server:${uuid}`).emit('server:players', { uuid, players });
        }
    }
    sendConsole(uuid, line) {
        const server = this.servers.get(uuid);
        if (server) {
            server.logBuffer.push(line);
            if (server.logBuffer.length > MAX_LOG_BUFFER)
                server.logBuffer.shift();
        }
        this.io?.to(`server:${uuid}`).emit('server:console', { uuid, data: line });
        this.emit('console', { uuid, line });
        this.trackPlayerEvents(uuid, line);
    }
    attachLogStream(uuid, containerId) {
        const d = (0, dockerService_1.getDocker)();
        const container = d.getContainer(containerId);
        container.logs({
            stdout: true,
            stderr: true,
            follow: true,
            timestamps: false,
            tail: 50,
        }, (err, stream) => {
            if (err || !stream)
                return;
            const server = this.servers.get(uuid);
            if (server)
                server.logStream = stream;
            let buffer = '';
            stream.on('data', (chunk) => {
                // Containers with Tty:true produce raw output (no 8-byte Docker multiplexer
                // frame header). Non-TTY containers do have the header. Detect by checking
                // the Docker frame magic: byte 0 = 0x01 (stdout) or 0x02 (stderr), bytes
                // 1-3 = 0x00 (reserved).
                const isMultiplexed = chunk.length > 8 &&
                    (chunk[0] === 0x01 || chunk[0] === 0x02) &&
                    chunk[1] === 0x00 && chunk[2] === 0x00 && chunk[3] === 0x00;
                const data = isMultiplexed
                    ? chunk.slice(8).toString('utf8')
                    : chunk.toString('utf8');
                buffer += data;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                lines.forEach(line => {
                    if (line.trim())
                        this.sendConsole(uuid, line);
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
    attachStdinStream(uuid, containerId) {
        const d = (0, dockerService_1.getDocker)();
        const container = d.getContainer(containerId);
        return new Promise((resolve) => {
            container.attach({ stream: true, stdin: true, stdout: false, stderr: false }, (err, stream) => {
                if (err || !stream) {
                    logger_1.logger.warn(`stdin attach failed for ${uuid}: ${err?.message ?? 'no stream'}`);
                    resolve();
                    return;
                }
                const srv = this.servers.get(uuid);
                if (srv)
                    srv.stdinStream = stream;
                const cleanup = () => {
                    const s = this.servers.get(uuid);
                    if (s)
                        s.stdinStream = undefined;
                };
                stream.on('error', cleanup);
                stream.on('close', cleanup);
                stream.on('end', cleanup);
                resolve();
            });
        });
    }
    startStatsInterval(uuid) {
        const server = this.servers.get(uuid);
        if (!server)
            return;
        clearInterval(server.statsInterval);
        server.statsInterval = setInterval(async () => {
            if (server.status !== 'running')
                return;
            const resources = await this.getResources(uuid);
            this.io?.to(`server:${uuid}`).emit('server:stats', { uuid, ...resources });
        }, 2000);
    }
    async deleteServer(uuid) {
        await this.stopServer(uuid, true);
        this.servers.delete(uuid);
        const cfg = (0, config_1.getConfig)();
        const dataPath = path_1.default.join(cfg.system.data, uuid);
        fs_1.default.rmSync(dataPath, { recursive: true, force: true });
        logger_1.logger.info(`Server deleted: ${uuid}`);
    }
    getServerList() {
        return Array.from(this.servers.keys());
    }
}
async function getDirSize(dirPath) {
    if (!fs_1.default.existsSync(dirPath))
        return 0;
    let size = 0;
    const items = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
        const p = path_1.default.join(dirPath, item.name);
        if (item.isDirectory())
            size += await getDirSize(p);
        else
            size += fs_1.default.statSync(p).size;
    }
    return size;
}
exports.serverManager = new ServerManager();
//# sourceMappingURL=serverManager.js.map