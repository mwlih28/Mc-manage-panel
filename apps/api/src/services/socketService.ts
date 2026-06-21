import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

interface ConsoleMessage {
  type: 'output' | 'input' | 'status';
  data: string;
  timestamp: number;
}

const serverIntervals = new Map<string, NodeJS.Timeout>();

export function initSocketServer(httpServer: HttpServer, corsOrigin: string): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Authentication middleware
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

    // Subscribe to server console
    socket.on('server:subscribe', async (serverId: string) => {
      const isAdmin = socket.data.user?.role === 'ADMIN';
      const server = await prisma.server.findFirst({
        where: {
          id: serverId,
          ...(isAdmin ? {} : { userId: socket.data.user?.id }),
        },
        include: { node: true },
      });

      if (!server) {
        socket.emit('error', 'Server not found or access denied');
        return;
      }

      socket.join(`server:${serverId}`);
      logger.debug(`Socket ${socket.id} subscribed to server ${serverId}`);

      // Send initial status
      socket.emit('server:status', {
        serverId,
        status: server.status,
        timestamp: Date.now(),
      });

      // Simulate server stats
      const statsInterval = setInterval(() => {
        if (server.status === 'RUNNING') {
          socket.emit('server:stats', {
            serverId,
            cpuAbsolute: Math.random() * server.cpu || Math.random() * 100,
            memoryBytes: Math.floor(Math.random() * server.memory * 0.8 * 1048576),
            memoryLimitBytes: server.memory * 1048576,
            diskBytes: Math.floor(Math.random() * server.disk * 0.5 * 1048576),
            networkRxBytes: Math.floor(Math.random() * 1000000),
            networkTxBytes: Math.floor(Math.random() * 1000000),
            uptime: Math.floor(Math.random() * 86400),
            timestamp: Date.now(),
          });
        }
      }, 3000);

      serverIntervals.set(`${socket.id}:${serverId}`, statsInterval);

      // Simulate console output
      const consoleLines = [
        '[Server] Loading properties',
        '[Server] Starting server version 1.20.1',
        '[Server] Preparing spawn area: 0%',
        '[Server] Preparing spawn area: 30%',
        '[Server] Preparing spawn area: 70%',
        '[Server] Done! For help, type "help"',
      ];

      if (server.status === 'RUNNING') {
        consoleLines.forEach((line, i) => {
          setTimeout(() => {
            socket.emit('server:console', {
              serverId,
              type: 'output',
              data: line,
              timestamp: Date.now() - (consoleLines.length - i) * 1000,
            } as ConsoleMessage);
          }, i * 100);
        });
      }
    });

    // Unsubscribe from server
    socket.on('server:unsubscribe', (serverId: string) => {
      socket.leave(`server:${serverId}`);
      const key = `${socket.id}:${serverId}`;
      const interval = serverIntervals.get(key);
      if (interval) {
        clearInterval(interval);
        serverIntervals.delete(key);
      }
    });

    // Send command to server
    socket.on('server:command', async ({ serverId, command }: { serverId: string; command: string }) => {
      const isAdmin = socket.data.user?.role === 'ADMIN';
      const server = await prisma.server.findFirst({
        where: {
          id: serverId,
          ...(isAdmin ? {} : { userId: socket.data.user?.id }),
        },
      });

      if (!server) return;

      // Echo back the command
      io.to(`server:${serverId}`).emit('server:console', {
        serverId,
        type: 'input',
        data: `> ${command}`,
        timestamp: Date.now(),
      } as ConsoleMessage);

      // Simulate response
      if (command.toLowerCase() === 'list') {
        setTimeout(() => {
          io.to(`server:${serverId}`).emit('server:console', {
            serverId,
            type: 'output',
            data: 'There are 0 of a max of 20 players online:',
            timestamp: Date.now(),
          } as ConsoleMessage);
        }, 200);
      }
    });

    // Power action via socket
    socket.on('server:power', async ({ serverId, action }: { serverId: string; action: string }) => {
      const isAdmin = socket.data.user?.role === 'ADMIN';
      const server = await prisma.server.findFirst({
        where: {
          id: serverId,
          ...(isAdmin ? {} : { userId: socket.data.user?.id }),
        },
      });

      if (!server) return;

      const statusMap: Record<string, string> = {
        start: 'STARTING',
        stop: 'STOPPING',
        restart: 'STOPPING',
        kill: 'OFFLINE',
      };

      const newStatus = statusMap[action] as 'STARTING' | 'STOPPING' | 'OFFLINE';
      if (!newStatus) return;

      await prisma.server.update({ where: { id: serverId }, data: { status: newStatus } });

      io.to(`server:${serverId}`).emit('server:status', { serverId, status: newStatus, timestamp: Date.now() });

      // Simulate state transitions
      if (action === 'start') {
        setTimeout(async () => {
          await prisma.server.update({ where: { id: serverId }, data: { status: 'RUNNING' } });
          io.to(`server:${serverId}`).emit('server:status', { serverId, status: 'RUNNING', timestamp: Date.now() });
          io.to(`server:${serverId}`).emit('server:console', {
            serverId, type: 'output', data: '[Server] Done! For help, type "help"', timestamp: Date.now(),
          });
        }, 5000);
      } else if (action === 'stop' || action === 'restart') {
        setTimeout(async () => {
          await prisma.server.update({ where: { id: serverId }, data: { status: 'OFFLINE' } });
          io.to(`server:${serverId}`).emit('server:status', { serverId, status: 'OFFLINE', timestamp: Date.now() });
        }, 3000);
      }
    });

    socket.on('disconnect', () => {
      // Clean up all intervals for this socket
      for (const [key, interval] of serverIntervals.entries()) {
        if (key.startsWith(socket.id)) {
          clearInterval(interval);
          serverIntervals.delete(key);
        }
      }
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}
