import { io as ioClient, Socket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import { logger } from '../utils/logger';

interface NodeInfo {
  id: string;
  fqdn: string;
  daemonPort: number;
  scheme: string;
  token: string;
}

interface NodeConnection {
  socket: Socket;
  subscribedUuids: Set<string>;
}

export interface ConsoleLine {
  type: 'output' | 'input' | 'status';
  data: string;
  timestamp: number;
}

const MAX_CONSOLE_BUFFER = 300;
export const consoleBuffer = new Map<string, ConsoleLine[]>();

export interface StatsEntry {
  cpuAbsolute: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  timestamp: number;
}

const MAX_STATS_BUFFER = 120;
export const statsBuffer = new Map<string, StatsEntry[]>();

export function pushConsoleBuffer(uuid: string, line: ConsoleLine): void {
  const buf = consoleBuffer.get(uuid) ?? [];
  buf.push(line);
  if (buf.length > MAX_CONSOLE_BUFFER) buf.shift();
  consoleBuffer.set(uuid, buf);
}

const nodeConnections = new Map<string, NodeConnection>();

const WINGS_TO_PANEL_STATUS: Record<string, string> = {
  running: 'RUNNING', offline: 'OFFLINE', starting: 'STARTING', stopping: 'STOPPING', installing: 'INSTALLING',
};

export function getOrConnectWings(node: NodeInfo, io: SocketServer): Socket {
  const existing = nodeConnections.get(node.id);
  if (existing) {
    return existing.socket;
  }

  const url = `${node.scheme}://${node.fqdn}:${node.daemonPort}`;
  const subscribedUuids = new Set<string>();

  const wingsSocket = ioClient(url, {
    auth: { token: node.token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 3000,
  });

  wingsSocket.on('connect', () => {
    logger.info(`Wings relay connected to node ${node.id} (${url})`);
    for (const uuid of subscribedUuids) {
      wingsSocket.emit('subscribe', uuid);
      logger.debug(`Subscribed server ${uuid} on node ${node.id}`);
    }
  });

  wingsSocket.on('connect_error', (err) => {
    logger.warn(`Wings relay error for node ${node.id}: ${err.message}`);
  });

  wingsSocket.on('disconnect', (reason) => {
    logger.warn(`Wings relay disconnected from node ${node.id}: ${reason}`);
  });

  // Relay all Wings events to panel clients in the correct room
  wingsSocket.onAny((event: string, data: unknown) => {
    const handled = ['server:console', 'server:stats', 'server:status', 'server:console:history'];
    if (!handled.includes(event)) return;

    const payload = data as Record<string, unknown>;
    const uuid = payload?.uuid as string;

    // Wings sends history as { uuid, lines[] } so we can route it correctly
    if (event === 'server:console:history') {
      const h = data as { uuid?: string; lines?: ConsoleLine[] };
      if (h.uuid && Array.isArray(h.lines) && h.lines.length > 0) {
        h.lines.forEach((l) => pushConsoleBuffer(h.uuid!, l));
        io.to(`server:uuid:${h.uuid}`).emit('server:console:history', h.lines);
      }
      return;
    }

    if (!uuid) return;

    let relayData: unknown = data;
    if (event === 'server:status' && payload.state) {
      const panelStatus = WINGS_TO_PANEL_STATUS[payload.state as string]
        ?? (payload.state as string).toUpperCase();
      relayData = { ...payload, status: panelStatus };
    }
    if (event === 'server:stats') {
      const statsEntry: StatsEntry = {
        cpuAbsolute: typeof payload.cpu_absolute === 'number' ? payload.cpu_absolute : 0,
        memoryBytes: typeof payload.memory_bytes === 'number' ? payload.memory_bytes : 0,
        memoryLimitBytes: typeof payload.memory_limit_bytes === 'number' ? payload.memory_limit_bytes : 0,
        diskBytes: typeof payload.disk_bytes === 'number' ? payload.disk_bytes : 0,
        timestamp: Date.now(),
      };
      const sbuf = statsBuffer.get(uuid) ?? [];
      sbuf.push(statsEntry);
      if (sbuf.length > MAX_STATS_BUFFER) sbuf.shift();
      statsBuffer.set(uuid, sbuf);

      relayData = {
        uuid,
        ...statsEntry,
        networkRxBytes: typeof payload.network_rx_bytes === 'number' ? payload.network_rx_bytes : 0,
        networkTxBytes: typeof payload.network_tx_bytes === 'number' ? payload.network_tx_bytes : 0,
        uptime: typeof payload.uptime === 'number' ? payload.uptime : 0,
      };
    }
    if (event === 'server:console') {
      pushConsoleBuffer(uuid, {
        type: (payload.type as ConsoleLine['type']) ?? 'output',
        data: (payload.data as string) ?? '',
        timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
      });
    }
    io.to(`server:uuid:${uuid}`).emit(event, relayData);
  });

  nodeConnections.set(node.id, { socket: wingsSocket, subscribedUuids });
  return wingsSocket;
}

export function subscribeServerOnWings(nodeId: string, serverUuid: string): void {
  const conn = nodeConnections.get(nodeId);
  if (!conn) return;

  conn.subscribedUuids.add(serverUuid);
  if (conn.socket.connected) {
    conn.socket.emit('subscribe', serverUuid);
    logger.debug(`Subscribed server ${serverUuid} on node ${nodeId}`);
  }
}

export function sendCommandToWings(nodeId: string, serverUuid: string, command: string): void {
  const conn = nodeConnections.get(nodeId);
  if (conn?.socket.connected) {
    conn.socket.emit('command', { uuid: serverUuid, command });
    return;
  }
  throw new Error(`Wings socket not connected for node ${nodeId}`);
}

export function sendPowerToWings(nodeId: string, serverUuid: string, action: string): void {
  const conn = nodeConnections.get(nodeId);
  if (conn?.socket.connected) {
    conn.socket.emit('power', { uuid: serverUuid, action });
    return;
  }
  throw new Error(`Wings socket not connected for node ${nodeId}`);
}

export function disconnectNode(nodeId: string): void {
  const conn = nodeConnections.get(nodeId);
  if (conn) {
    conn.socket.disconnect();
    nodeConnections.delete(nodeId);
  }
}
