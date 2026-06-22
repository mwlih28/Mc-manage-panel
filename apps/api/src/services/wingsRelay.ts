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
    // Re-subscribe all servers after every (re)connect
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
    // Do NOT delete from map — socket.io will auto-reconnect and re-subscribe
  });

  // Relay all Wings events to panel clients in the correct room
  wingsSocket.onAny((event: string, data: unknown) => {
    if (event === 'server:console' || event === 'server:stats' || event === 'server:status') {
      const payload = data as Record<string, unknown>;
      const uuid = payload?.uuid as string;
      if (uuid) {
        let relayData: unknown = data;
        if (event === 'server:status' && payload.state) {
          const panelStatus = WINGS_TO_PANEL_STATUS[payload.state as string]
            ?? (payload.state as string).toUpperCase();
          relayData = { ...payload, status: panelStatus };
        }
        // Normalize Wings snake_case stats → client camelCase
        if (event === 'server:stats') {
          relayData = {
            uuid,
            cpuAbsolute: payload.cpu_absolute ?? 0,
            memoryBytes: payload.memory_bytes ?? 0,
            memoryLimitBytes: payload.memory_limit_bytes ?? 0,
            diskBytes: payload.disk_bytes ?? 0,
            networkRxBytes: payload.network_rx_bytes ?? 0,
            networkTxBytes: payload.network_tx_bytes ?? 0,
            uptime: payload.uptime ?? 0,
            timestamp: Date.now(),
          };
        }
        io.to(`server:uuid:${uuid}`).emit(event, relayData);
      }
    }
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
  // If not connected yet, the 'connect' handler above will send all pending subs
}

export function sendCommandToWings(nodeId: string, serverUuid: string, command: string): void {
  const conn = nodeConnections.get(nodeId);
  if (conn?.socket.connected) {
    conn.socket.emit('command', { uuid: serverUuid, command });
  }
}

export function sendPowerToWings(nodeId: string, serverUuid: string, action: string): void {
  const conn = nodeConnections.get(nodeId);
  if (conn?.socket.connected) {
    conn.socket.emit('power', { uuid: serverUuid, action });
  }
}

export function disconnectNode(nodeId: string): void {
  const conn = nodeConnections.get(nodeId);
  if (conn) {
    conn.socket.disconnect();
    nodeConnections.delete(nodeId);
  }
}
