import Docker from 'dockerode';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

let docker: Docker | null = null;

export function getDocker(): Docker {
  if (docker) return docker;
  const cfg = getConfig();
  docker = new Docker({ socketPath: cfg.docker.socket });
  return docker;
}

export async function ensureNetwork(): Promise<void> {
  const d = getDocker();
  const cfg = getConfig();
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
      logger.info(`Created Docker network: ${netName}`);
    }
  } catch (err) {
    logger.error('Failed to ensure Docker network', err);
  }
}

export async function pullImage(image: string): Promise<void> {
  const d = getDocker();
  logger.info(`Pulling image: ${image}`);

  return new Promise((resolve, reject) => {
    d.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      d.modem.followProgress(stream,
        (err: Error | null) => {
          if (err) return reject(err);
          logger.info(`Image pulled: ${image}`);
          resolve();
        },
        (event: { status: string; progress?: string }) => {
          logger.debug(`Pull progress: ${event.status} ${event.progress || ''}`);
        }
      );
    });
  });
}

export async function imageExists(image: string): Promise<boolean> {
  try {
    const d = getDocker();
    await d.getImage(image).inspect();
    return true;
  } catch {
    return false;
  }
}

export async function containerExists(name: string): Promise<string | null> {
  try {
    const d = getDocker();
    const containers = await d.listContainers({
      all: true,
      filters: { name: [`mc_${name}`] },
    });
    return containers.length > 0 ? containers[0].Id : null;
  } catch {
    return null;
  }
}

export async function createContainer(
  serverUuid: string,
  image: string,
  cmd: string,
  env: Record<string, string>,
  limits: {
    memory: number;
    swap: number;
    cpu: number;
    disk: number;
    io: number;
    oomDisabled: boolean;
  },
  dataPath: string
): Promise<Docker.Container> {
  const d = getDocker();
  const cfg = getConfig();
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

  return container as unknown as Docker.Container;
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
export async function ensureVolumePermissions(image: string, dataPath: string): Promise<void> {
  const d = getDocker();
  const name = `mc_perms_${Date.now().toString(36)}`;

  // Remove any stale perms container
  try {
    const existing = await d.listContainers({ all: true, filters: { name: [name] } });
    if (existing.length > 0) await d.getContainer(existing[0].Id).remove({ force: true });
  } catch { /* ignore */ }

  const container = await d.createContainer({
    name,
    Image: image,
    Entrypoint: ['/bin/sh', '-c'],
    Cmd: ['chown -R 1000:1000 /mnt/server && chmod -R u+rwX,go+rX /mnt/server'],
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
    const result = await (container as unknown as { wait(): Promise<{ StatusCode: number }> }).wait();
    if (result.StatusCode !== 0) {
      logger.warn(`ensureVolumePermissions exited with code ${result.StatusCode} for ${dataPath}`);
    }
  } finally {
    await container.remove({ force: true }).catch(() => { /* ignore */ });
  }
}

export async function getContainerStats(containerId: string): Promise<{
  cpu: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  networkRx: number;
  networkTx: number;
}> {
  const d = getDocker();
  const container = d.getContainer(containerId);

  return new Promise((resolve, reject) => {
    container.stats({ stream: false }, (err: Error | null, data: Docker.ContainerStats | undefined) => {
      if (err) return reject(err);
      if (!data) return resolve({ cpu: 0, memoryBytes: 0, memoryLimitBytes: 0, networkRx: 0, networkTx: 0 });

      const cpuDelta = data.cpu_stats.cpu_usage.total_usage - (data.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta = data.cpu_stats.system_cpu_usage - (data.precpu_stats?.system_cpu_usage || 0);
      const cpuCount = data.cpu_stats.online_cpus || 1;
      const cpu = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

      const memUsage = data.memory_stats.usage || 0;
      const memCache = (data.memory_stats.stats as Record<string, number>)?.cache || 0;
      const memBytes = memUsage - memCache;
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
