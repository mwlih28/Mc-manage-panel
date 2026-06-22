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
class ServerManager extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.servers = new Map();
    }
    setSocketServer(io) {
        this.io = io;
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
        this.servers.set(config.uuid, {
            config,
            status,
            containerId: containerId || undefined,
            startedAt: status === 'running' ? new Date() : undefined,
        });
        if (status === 'running' && containerId) {
            this.attachLogStream(config.uuid, containerId);
            this.startStatsInterval(config.uuid);
        }
        logger_1.logger.info(`Server loaded: ${config.uuid} (${status})`);
    }
    async startServer(uuid) {
        const server = this.servers.get(uuid);
        if (!server)
            throw new Error(`Server ${uuid} not found`);
        if (server.status === 'running' || server.status === 'starting')
            return;
        this.setStatus(uuid, 'starting');
        const cfg = (0, config_1.getConfig)();
        const dataPath = path_1.default.join(cfg.system.data, uuid);
        fs_1.default.mkdirSync(dataPath, { recursive: true });
        // Auto-accept Minecraft EULA
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
        try {
            const { config } = server;
            // Substitute {{VAR}} placeholders in invocation with environment values
            const invocation = config.invocation.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
                return config.environment[key.trim()] ?? '';
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
            // Run install script on first start (when server jar doesn't exist)
            const jarFile = config.environment['SERVER_JARFILE'] || 'server.jar';
            const isFirstStart = !fs_1.default.existsSync(path_1.default.join(dataPath, jarFile));
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
            this.attachLogStream(uuid, container.id);
            this.startStatsInterval(uuid);
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
        if (server.status === 'offline')
            return;
        this.setStatus(uuid, 'stopping');
        clearInterval(server.statsInterval);
        if (server.logStream) {
            try {
                server.logStream.destroy?.();
            }
            catch { /* ignore */ }
            server.logStream = undefined;
        }
        if (server.containerId) {
            try {
                const d = (0, dockerService_1.getDocker)();
                const container = d.getContainer(server.containerId);
                if (kill) {
                    await container.kill();
                }
                else {
                    // Send MC stop command directly — cannot use this.sendCommand() here because
                    // status is already 'stopping' and sendCommand guards against non-running states.
                    const stopCmd = (server.config.environment['MC_STOP_COMMAND'] || 'stop').replace(/"/g, '\\"');
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
        server.containerId = undefined;
        server.startedAt = undefined;
        this.setStatus(uuid, 'offline');
        logger_1.logger.info(`Server stopped: ${uuid}`);
    }
    async restartServer(uuid) {
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
        try {
            const d = (0, dockerService_1.getDocker)();
            const container = d.getContainer(server.containerId);
            const exec = await container.exec({
                AttachStdin: true,
                AttachStdout: false,
                AttachStderr: false,
                Cmd: ['/bin/sh', '-c', `echo "${command.replace(/"/g, '\\"')}" > /proc/1/fd/0`],
            });
            await exec.start({ hijack: true, stdin: true });
        }
        catch {
            // Fallback: try to attach to container stdin
            try {
                const d = (0, dockerService_1.getDocker)();
                const container = d.getContainer(server.containerId);
                const stream = await container.attach({ stream: true, stdin: true, stdout: false, stderr: false });
                stream.write(command + '\n');
                stream.end();
            }
            catch (err) {
                logger_1.logger.error(`Failed to send command to ${uuid}:`, err);
            }
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
    async runInstallScript(uuid, config, dataPath) {
        const d = (0, dockerService_1.getDocker)();
        const installName = `mc_install_${uuid}`;
        // Use server image (has curl/python3); pull if needed
        if (!await (0, dockerService_1.imageExists)(config.image)) {
            this.sendConsole(uuid, `[Wings] Pulling image ${config.image}...`);
            await (0, dockerService_1.pullImage)(config.image);
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
            Image: config.image,
            Cmd: ['/bin/bash', '/mnt/server/.wings_install.sh'],
            Env: envArray,
            User: '1000',
            WorkingDir: '/mnt/server',
            AttachStdout: true,
            AttachStderr: true,
            HostConfig: {
                Binds: [`${dataPath}:/mnt/server`],
                NetworkMode: 'bridge',
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
        this.emit('status', { uuid, status });
        this.io?.to(`server:${uuid}`).emit('server:status', { uuid, state: status });
        panelClient_1.panelClient.reportStatus(uuid, status).catch(() => { });
    }
    sendConsole(uuid, line) {
        this.io?.to(`server:${uuid}`).emit('server:console', { uuid, data: line });
        this.emit('console', { uuid, line });
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
                // Docker multiplexes stdout/stderr — strip 8-byte header
                const data = chunk.length > 8 ? chunk.slice(8).toString('utf8') : chunk.toString('utf8');
                buffer += data;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                lines.forEach(line => {
                    if (line.trim())
                        this.sendConsole(uuid, line);
                });
            });
            stream.on('end', () => {
                const server = this.servers.get(uuid);
                if (server?.status === 'running') {
                    this.setStatus(uuid, 'offline');
                }
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