import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { sendPowerAction, sendCommand as wingsSendCommand } from './wingsClient';
import {
  getOrConnectWings, subscribeServerOnWings,
  sendCommandToWings, sendPowerToWings,
  consoleBuffer, pushConsoleBuffer,
} from './wingsRelay';

interface ConsoleMessage {
  type: 'output' | 'input' | 'status';
  data: string;
  timestamp: number;
}

export function initSocketServer(httpServer: HttpServer, corsOrigin: string): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.slice(7);
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) return next(new Error('User not found'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id} (user: ${socket.data.user?.email})`);

    socket.on('server:subscribe', async (serverId: string) => {
      const isAdmin = socket.data.user?.role === 'ADMIN';
      const server = await prisma.server.findFirst({
        where: { id: serverId, ...(isAdmin ? {} : { userId: socket.data.user?.id }) },
        include: { node: true },
      });
      if (!server) { socket.emit('error', 'Server not found or access denied'); return; }

      // Room keyed by panel server ID for panel clients
      socket.join(`server:${serverId}`);
      // Room keyed by wings uuid for relay
      socket.join(`server:uuid:${server.uuid}`);

      // Send initial status
      socket.emit('server:status', { serverId, status: server.status, timestamp: Date.now() });

      // Replay console history so the client gets recent output after refresh
      const history = consoleBuffer.get(server.uuid) ?? [];
      if (history.length > 0) {
        socket.emit('server:console:history', history);
      }

      // Connect to Wings relay if node available
      if (server.node) {
        try {
          getOrConnectWings({
            id: server.node.id,
            fqdn: server.node.fqdn,
            daemonPort: server.node.daemonPort,
            scheme: server.node.scheme,
            token: server.node.token,
          }, io);
          subscribeServerOnWings(server.node.id, server.uuid);
        } catch (err) {
          logger.warn(`Could not connect Wings relay for server ${serverId}: ${(err as Error).message}`);
        }
      }
    });

    socket.on('server:unsubscribe', (serverId: string) => {
      socket.leave(`server:${serverId}`);
    });

    socket.on('server:command', async ({ serverId, command }: { serverId: string; command: string }) => {
      const isAdmin = socket.data.user?.role === 'ADMIN';
      const server = await prisma.server.findFirst({
        where: { id: serverId, ...(isAdmin ? {} : { userId: socket.data.user?.id }) },
        include: { node: true },
      });
      if (!server) return;

      // Echo command to panel clients and buffer it
      const inputLine: ConsoleMessage = { type: 'input', data: `> ${command}`, timestamp: Date.now() };
      io.to(`server:${serverId}`).emit('server:console', { serverId, ...inputLine });
      pushConsoleBuffer(server.uuid, inputLine);

      // Try Wings relay first, fall back to HTTP
      if (server.node) {
        try {
          sendCommandToWings(server.node.id, server.uuid, command);
        } catch {
          try {
            await wingsSendCommand(server as Parameters<typeof wingsSendCommand>[0], command);
          } catch (err) {
            logger.warn(`Failed to send command to Wings: ${(err as Error).message}`);
          }
        }
      }
    });

    socket.on('server:power', async ({ serverId, action }: { serverId: string; action: string }) => {
      const isAdmin = socket.data.user?.role === 'ADMIN';
      const server = await prisma.server.findFirst({
        where: { id: serverId, ...(isAdmin ? {} : { userId: socket.data.user?.id }) },
        include: { node: true, egg: true },
      });
      if (!server) return;

      const isBedrockEgg = server.egg.name.toLowerCase().includes('bedrock') || server.egg.startup.includes('bedrock_server');
      if (action === 'start' && !isBedrockEgg && !server.eulaAccepted) {
        socket.emit('error', 'EULA_NOT_ACCEPTED');
        return;
      }

      const transitStatus: Record<string, string> = {
        start: 'STARTING', stop: 'STOPPING', restart: 'STOPPING', kill: 'OFFLINE',
      };
      const newStatus = transitStatus[action];
      if (!newStatus) return;

      await prisma.server.update({ where: { id: serverId }, data: { status: newStatus as 'STARTING' | 'STOPPING' | 'OFFLINE' } });
      io.to(`server:${serverId}`).emit('server:status', { serverId, status: newStatus, timestamp: Date.now() });

      // Try Wings relay first, fall back to HTTP
      if (server.node) {
        try {
          sendPowerToWings(server.node.id, server.uuid, action);
        } catch {
          try {
            await sendPowerAction(
              server as Parameters<typeof sendPowerAction>[0],
              action as 'start' | 'stop' | 'restart' | 'kill'
            );
          } catch (err) {
            logger.warn(`Failed to send power action to Wings: ${(err as Error).message}`);
          }
        }
      }
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}
