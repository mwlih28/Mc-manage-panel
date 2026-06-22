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

// One Wings socket connection per node
const nodeConnections = new Map<string, Socket>();

export function getOrConnectWings(node: NodeInfo, io: SocketServer): Socket {
  if (nodeConnections.has(node.id)) {
    return nodeConnections.get(node.id)!;
  }

  const url = `${node.scheme}://${node.fqdn}:${node.daemonPort}`;
  const wingsSocket = ioClient(url, {
    auth: { token: node.token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 3000,
  });

  wingsSocket.on('connect', () => {
    logger.info(`Wings relay connected to node ${node.id} (${url})`);
  });

  wingsSocket.on('connect_error', (err) => {
    logger.warn(`Wings relay error for node ${node.id}: ${err.message}`);
  });

  wingsSocket.on('disconnect', () => {
    logger.warn(`Wings relay disconnected from node ${node.id}`);
    nodeConnections.delete(node.id);
  });

  // Relay all Wings events to panel clients
  wingsSocket.onAny((event: string, data: unknown) => {
    if (event === 'server:console' || event === 'server:stats' || event === 'server:status') {
      const payload = data as Record<string, unknown>;
      const uuid = payload?.uuid as string;
      if (uuid) {
        // Find panel room by server uuid and relay
        io.to(`server:uuid:${uuid}`).emit(event, data);
      }
    }
  });

  nodeConnections.set(node.id, wingsSocket);
  return wingsSocket;
}

export function subscribeServerOnWings(nodeId: string, serverUuid: string): void {
  const socket = nodeConnections.get(nodeId);
  if (socket?.connected) {
    socket.emit('subscribe', serverUuid);
  }
}

export function sendCommandToWings(nodeId: string, serverUuid: string, command: string): void {
  const socket = nodeConnections.get(nodeId);
  if (socket?.connected) {
    socket.emit('command', { uuid: serverUuid, command });
  }
}

export function sendPowerToWings(nodeId: string, serverUuid: string, action: string): void {
  const socket = nodeConnections.get(nodeId);
  if (socket?.connected) {
    socket.emit('power', { uuid: serverUuid, action });
  }
}

export function disconnectNode(nodeId: string): void {
  const socket = nodeConnections.get(nodeId);
  if (socket) {
    socket.disconnect();
    nodeConnections.delete(nodeId);
  }
}
