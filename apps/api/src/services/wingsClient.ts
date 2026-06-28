import axios, { AxiosInstance } from 'axios';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { Server } from '@prisma/client';

interface WingsServerConfig {
  uuid: string;
  suspended: boolean;
  environment: Record<string, string>;
  invocation: string;
  image: string;
  installScript?: string;
  scriptContainer?: string;
  build: {
    memory_limit: number;
    swap: number;
    disk_space: number;
    io_weight: number;
    cpu_limit: number;
    oom_disabled: boolean;
  };
  mounts: unknown[];
  egg: { id: string; file_denylist: string[] };
  container: { image: string; requires_rebuild: boolean };
}

function getNodeClient(fqdn: string, port: number, scheme: string, token: string): AxiosInstance {
  return axios.create({
    baseURL: `${scheme}://${fqdn}:${port}/api`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

export async function sendPowerAction(
  server: Server & { node: { fqdn: string; daemonPort: number; scheme: string; token: string } },
  action: 'start' | 'stop' | 'restart' | 'kill'
): Promise<void> {
  const client = getNodeClient(
    server.node.fqdn,
    server.node.daemonPort,
    server.node.scheme,
    server.node.token
  );

  await client.post(`/servers/${server.uuid}/power`, { action });
}

export async function sendCommand(
  server: Server & { node: { fqdn: string; daemonPort: number; scheme: string; token: string } },
  command: string
): Promise<void> {
  const client = getNodeClient(
    server.node.fqdn,
    server.node.daemonPort,
    server.node.scheme,
    server.node.token
  );

  await client.post(`/servers/${server.uuid}/command`, { command });
}

export async function getServerResources(
  server: Server & { node: { fqdn: string; daemonPort: number; scheme: string; token: string } }
): Promise<{
  memory_bytes: number;
  memory_limit_bytes: number;
  cpu_absolute: number;
  disk_bytes: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  uptime: number;
  state: string;
}> {
  const client = getNodeClient(
    server.node.fqdn,
    server.node.daemonPort,
    server.node.scheme,
    server.node.token
  );

  const { data } = await client.get(`/servers/${server.uuid}/resources`);
  return data.resources;
}

type ServerWithEgg = Server & {
  egg: { startup: string; dockerImage: string; scriptInstall?: string | null; scriptContainer?: string | null };
};

export function buildWingsConfig(server: ServerWithEgg): WingsServerConfig {
  const env: Record<string, string> = {};
  try { Object.assign(env, JSON.parse(server.env as string)); } catch { /* ignore */ }
  return {
    uuid: server.uuid,
    suspended: server.suspended,
    environment: env,
    invocation: server.startup || server.egg.startup,
    image: server.image || server.egg.dockerImage,
    installScript: server.egg.scriptInstall ?? undefined,
    scriptContainer: server.egg.scriptContainer ?? undefined,
    build: {
      memory_limit: server.memory,
      swap: server.swap,
      disk_space: server.disk,
      io_weight: server.io,
      cpu_limit: server.cpu,
      oom_disabled: server.oomDisabled,
    },
    mounts: [],
    egg: { id: server.eggId, file_denylist: [] },
    container: { image: server.image, requires_rebuild: false },
  };
}

export async function createServerOnNode(
  server: ServerWithEgg & {
    node: { fqdn: string; daemonPort: number; scheme: string; token: string };
  }
): Promise<void> {
  const client = getNodeClient(
    server.node.fqdn,
    server.node.daemonPort,
    server.node.scheme,
    server.node.token
  );
  await client.post('/servers', buildWingsConfig(server));
  logger.info(`Server ${server.uuid} registered on Wings node ${server.node.fqdn}`);
}

export async function deleteServerFromNode(
  server: Server & { node: { fqdn: string; daemonPort: number; scheme: string; token: string } }
): Promise<void> {
  const client = getNodeClient(
    server.node.fqdn,
    server.node.daemonPort,
    server.node.scheme,
    server.node.token
  );

  await client.delete(`/servers/${server.uuid}`);
}

export async function checkNodeHealth(
  fqdn: string, port: number, scheme: string, token: string
): Promise<boolean> {
  try {
    const client = getNodeClient(fqdn, port, scheme, token);
    await client.get('/health');
    return true;
  } catch {
    return false;
  }
}

// Called by Wings daemon to list its servers
export async function getNodeServers(nodeId: string): Promise<WingsServerConfig[]> {
  const servers = await prisma.server.findMany({
    where: { nodeId },
    include: {
      egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } },
    },
  });

  return servers.map(server => {
    const env: Record<string, string> = {};
    try { Object.assign(env, JSON.parse(server.env)); } catch { /* ignore */ }

    return {
      uuid: server.uuid,
      suspended: server.suspended,
      environment: env,
      invocation: server.startup,
      image: server.image,
      installScript: server.egg.scriptInstall ?? undefined,
      scriptContainer: server.egg.scriptContainer ?? undefined,
      build: {
        memory_limit: server.memory,
        swap: server.swap,
        disk_space: server.disk,
        io_weight: server.io,
        cpu_limit: server.cpu,
        oom_disabled: server.oomDisabled,
      },
      mounts: [],
      egg: { id: server.eggId, file_denylist: [] },
      container: { image: server.image, requires_rebuild: false },
    };
  });
}
