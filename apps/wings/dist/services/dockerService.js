"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocker = getDocker;
exports.ensureNetwork = ensureNetwork;
exports.pullImage = pullImage;
exports.imageExists = imageExists;
exports.containerExists = containerExists;
exports.createContainer = createContainer;
exports.ensureVolumePermissions = ensureVolumePermissions;
exports.getContainerStats = getContainerStats;
const dockerode_1 = __importDefault(require("dockerode"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
let docker = null;
function getDocker() {
    if (docker)
        return docker;
    const cfg = (0, config_1.getConfig)();
    docker = new dockerode_1.default({ socketPath: cfg.docker.socket });
    return docker;
}
async function ensureNetwork() {
    const d = getDocker();
    const cfg = (0, config_1.getConfig)();
    const netName = cfg.docker.network || 'mc-wings';
    try {
        const networks = await d.listNetworks({ filters: { name: [netName] } });
        if (networks.length === 0) {
            await d.createNetwork({
                Name: netName,
                Driver: 'bridge',
                EnableIPv6: false,
                IPAM: { Driver: 'default' },
            });
            logger_1.logger.info(`Created Docker network: ${netName}`);
        }
    }
    catch (err) {
        logger_1.logger.error('Failed to ensure Docker network', err);
    }
}
async function pullImage(image) {
    const d = getDocker();
    logger_1.logger.info(`Pulling image: ${image}`);
    return new Promise((resolve, reject) => {
        d.pull(image, (err, stream) => {
            if (err)
                return reject(err);
            d.modem.followProgress(stream, (err) => {
                if (err)
                    return reject(err);
                logger_1.logger.info(`Image pulled: ${image}`);
                resolve();
            }, (event) => {
                logger_1.logger.debug(`Pull progress: ${event.status} ${event.progress || ''}`);
            });
        });
    });
}
async function imageExists(image) {
    try {
        const d = getDocker();
        await d.getImage(image).inspect();
        return true;
    }
    catch {
        return false;
    }
}
async function containerExists(name) {
    try {
        const d = getDocker();
        const containers = await d.listContainers({
            all: true,
            filters: { name: [`mc_${name}`] },
        });
        return containers.length > 0 ? containers[0].Id : null;
    }
    catch {
        return null;
    }
}
async function createContainer(serverUuid, image, cmd, env, limits, dataPath) {
    const d = getDocker();
    const cfg = (0, config_1.getConfig)();
    const containerName = `mc_${serverUuid}`;
    // yolks entrypoints run `eval "${STARTUP}"` and ignore Docker CMD entirely.
    // Inject mkdir into STARTUP so the cache dir exists before Paper/Paperclip runs.
    const startupCmd = `mkdir -p /home/container/cache /home/container/logs 2>/dev/null; ${cmd}`;
    const envArray = [
        ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
        `STARTUP=${startupCmd}`,
    ];
    const memBytes = limits.memory * 1024 * 1024;
    const swapBytes = limits.swap > 0 ? (limits.memory + limits.swap) * 1024 * 1024 : -1;
    const cpuQuota = limits.cpu > 0 ? Math.floor(limits.cpu * 1000) : -1;
    const serverPort = parseInt(env['SERVER_PORT'] || env['PORT'] || '25565', 10);
    const exposedPorts = {
        [`${serverPort}/tcp`]: {},
        [`${serverPort}/udp`]: {},
    };
    const portBindings = {
        [`${serverPort}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: `${serverPort}` }],
        [`${serverPort}/udp`]: [{ HostIp: '0.0.0.0', HostPort: `${serverPort}` }],
    };
    const container = await d.createContainer({
        name: containerName,
        Image: image,
        Cmd: ['/bin/sh', '-c', startupCmd],
        Env: envArray,
        Hostname: serverUuid.slice(0, 8),
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        Tty: true,
        WorkingDir: '/home/container',
        ExposedPorts: exposedPorts,
        HostConfig: {
            Binds: [`${dataPath}:/home/container`],
            Memory: memBytes,
            MemorySwap: swapBytes,
            OomKillDisable: limits.oomDisabled,
            CpuQuota: cpuQuota,
            CpuPeriod: 100000,
            BlkioWeight: limits.io,
            PidsLimit: cfg.docker.container_pid_limit,
            NetworkMode: cfg.docker.network || 'mc-wings',
            PortBindings: portBindings,
            RestartPolicy: { Name: 'no' },
            LogConfig: {
                Type: 'json-file',
                Config: { 'max-size': '5m', 'max-file': '1' },
            },
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges'],
            ReadonlyRootfs: false,
        },
        Labels: {
            'mc-wings.server': serverUuid,
            'mc-wings.managed': 'true',
        },
    });
    return container;
}
/**
 * Ensure the server data volume is owned by uid 1000 (the container runtime user).
 *
 * The yolks images run as uid 1000 via an ENTRYPOINT that switches user regardless
 * of Docker's User setting, and the main container drops ALL capabilities — so it
 * cannot fix its own volume ownership. The Wings process itself often cannot chown
 * the host directory (it is not root / does not own it). We therefore run a tiny,
 * short-lived container as root with the entrypoint overridden (to bypass the
 * uid-1000 switch). Since the Docker daemon runs as root and there is no user
 * namespace remapping, container-root == host-root, so this chown affects the
 * bind-mounted host directory directly.
 */
async function ensureVolumePermissions(image, dataPath) {
    const d = getDocker();
    const name = `mc_perms_${Date.now().toString(36)}`;
    // Remove any stale perms container
    try {
        const existing = await d.listContainers({ all: true, filters: { name: [name] } });
        if (existing.length > 0)
            await d.getContainer(existing[0].Id).remove({ force: true });
    }
    catch { /* ignore */ }
    const container = await d.createContainer({
        name,
        Image: image,
        Entrypoint: ['/bin/sh', '-c'],
        // a+rwX: give everyone read+write, plus execute on directories only.
        // Using absolute assignment (=) instead of additive (+) so stale restrictive
        // permissions from any previous owner or umask cannot block writes.
        Cmd: ['chown -R 1000:1000 /mnt/server && find /mnt/server -type d -exec chmod 777 {} + && find /mnt/server -type f -exec chmod 666 {} +'],
        User: '0',
        WorkingDir: '/mnt/server',
        HostConfig: {
            Binds: [`${dataPath}:/mnt/server`],
            NetworkMode: 'none',
            AutoRemove: false,
        },
    });
    try {
        await container.start();
        const result = await container.wait();
        if (result.StatusCode !== 0) {
            logger_1.logger.warn(`ensureVolumePermissions exited with code ${result.StatusCode} for ${dataPath}`);
        }
    }
    finally {
        await container.remove({ force: true }).catch(() => { });
    }
}
// Tracks previous CPU sample per container so that independent stream=false calls
// can still compute a meaningful delta (precpu_stats is empty on first call).
const prevCpuStats = new Map();
async function getContainerStats(containerId) {
    const d = getDocker();
    const container = d.getContainer(containerId);
    return new Promise((resolve, reject) => {
        container.stats({ stream: false }, (err, data) => {
            if (err)
                return reject(err);
            if (!data)
                return resolve({ cpu: 0, memoryBytes: 0, memoryLimitBytes: 0, networkRx: 0, networkTx: 0 });
            const currTotal = data.cpu_stats.cpu_usage.total_usage || 0;
            const currSystem = data.cpu_stats.system_cpu_usage || 0;
            const cpuCount = data.cpu_stats.online_cpus || data.cpu_stats.cpu_usage.percpu_usage?.length || 1;
            // Prefer our own stored previous sample over Docker's precpu_stats (which is
            // empty on the first stream=false call and may be stale in some Docker versions).
            const prev = prevCpuStats.get(containerId);
            const prevTotal = prev?.totalUsage ?? (data.precpu_stats?.cpu_usage?.total_usage || 0);
            const prevSystem = prev?.systemUsage ?? (data.precpu_stats?.system_cpu_usage || 0);
            const cpuDelta = currTotal - prevTotal;
            const systemDelta = currSystem - prevSystem;
            const cpu = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
            prevCpuStats.set(containerId, { totalUsage: currTotal, systemUsage: currSystem });
            const memUsage = data.memory_stats.usage || 0;
            const memStats = data.memory_stats.stats;
            // cgroups v1 uses 'cache'; cgroups v2 uses 'inactive_file'
            const reclaimable = memStats?.inactive_file ?? memStats?.cache ?? 0;
            const memBytes = Math.max(0, memUsage - reclaimable);
            const memLimit = data.memory_stats.limit || 0;
            const networks = data.networks || {};
            let networkRx = 0;
            let networkTx = 0;
            for (const iface of Object.values(networks)) {
                networkRx += iface.rx_bytes || 0;
                networkTx += iface.tx_bytes || 0;
            }
            resolve({
                cpu: Math.max(0, parseFloat(cpu.toFixed(2))),
                memoryBytes: Math.max(0, memBytes),
                memoryLimitBytes: memLimit,
                networkRx,
                networkTx,
            });
        });
    });
}
//# sourceMappingURL=dockerService.js.map