import { io as ioClient, Socket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { logActivity } from './activityService';

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

// statsBuffer above only covers the last couple of minutes and lives in
// process memory — persist a thinned-out sample to the DB periodically so
// the panel can chart usage over hours/days and survive an API restart.
const PERSIST_INTERVAL_MS = 60 * 1000;
const STAT_SAMPLE_RETENTION_DAYS = 7;
const lastPersistedAt = new Map<string, number>();
let lastCleanupAt = 0;

function persistStatSample(uuid: string, entry: StatsEntry): void {
  const now = Date.now();
  const last = lastPersistedAt.get(uuid) ?? 0;
  if (now - last < PERSIST_INTERVAL_MS) return;
  lastPersistedAt.set(uuid, now);

  prisma.server.findFirst({ where: { uuid }, select: { id: true } })
    .then((server) => {
      if (!server) return;
      return prisma.serverStatSample.create({
        data: {
          serverId: server.id,
          cpu: entry.cpuAbsolute,
          memoryBytes: BigInt(Math.round(entry.memoryBytes)),
          memoryLimitBytes: BigInt(Math.round(entry.memoryLimitBytes)),
          diskBytes: BigInt(Math.round(entry.diskBytes)),
        },
      });
    })
    .catch((err: Error) => logger.warn(`Failed to persist stat sample for ${uuid}: ${err.message}`));

  if (now - lastCleanupAt > 6 * 60 * 60 * 1000) {
    lastCleanupAt = now;
    const cutoff = new Date(now - STAT_SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    prisma.serverStatSample.deleteMany({ where: { timestamp: { lt: cutoff } } })
      .then((r) => { if (r.count > 0) logger.info(`Pruned ${r.count} old stat sample(s)`); })
      .catch((err: Error) => logger.warn(`Stat sample cleanup failed: ${err.message}`));
  }
}

// ── Auto-optimize: sustained CPU/memory pressure is the most common cause
// of "ping dalgalanması" (tick lag) regardless of which server software is
// running, so it's used as the universal trigger instead of trying to
// parse `/tps` output — that only exists on some server types and would
// silently do nothing on Bedrock/Vanilla/Forge, which is worse than not
// having the feature at all.
const CPU_TRIGGER_PCT = 90;
const MEMORY_TRIGGER_PCT = 95;
const SUSTAINED_WINDOW_MS = 60 * 1000;
const OPTIMIZE_COOLDOWN_MS = 5 * 60 * 1000;
const cpuSampleHistory = new Map<string, { value: number; at: number }[]>();
const lastOptimizeAt = new Map<string, number>();

function checkAutoOptimize(nodeId: string, uuid: string, entry: StatsEntry): void {
  const now = Date.now();
  const hist = (cpuSampleHistory.get(uuid) ?? []).filter((s) => now - s.at < SUSTAINED_WINDOW_MS);
  hist.push({ value: entry.cpuAbsolute, at: now });
  cpuSampleHistory.set(uuid, hist);

  // Require samples spanning most of the window before judging it "sustained"
  // rather than a momentary spike (e.g. a single chunk-gen burst).
  if (hist.length < 5 || now - hist[0].at < SUSTAINED_WINDOW_MS * 0.8) return;

  const avgCpu = hist.reduce((sum, s) => sum + s.value, 0) / hist.length;
  const memPct = entry.memoryLimitBytes > 0 ? (entry.memoryBytes / entry.memoryLimitBytes) * 100 : 0;
  const cpuTriggered = avgCpu > CPU_TRIGGER_PCT;
  const memTriggered = memPct > MEMORY_TRIGGER_PCT;
  if (!cpuTriggered && !memTriggered) return;

  const lastRun = lastOptimizeAt.get(uuid) ?? 0;
  if (now - lastRun < OPTIMIZE_COOLDOWN_MS) return;
  lastOptimizeAt.set(uuid, now);

  (async () => {
    const server = await prisma.server.findFirst({
      where: { uuid },
      include: { egg: { select: { name: true, startup: true } } },
    });
    if (!server || !server.autoOptimizeEnabled) return;

    const isBedrock = server.egg.name.toLowerCase().includes('bedrock') || server.egg.startup.includes('bedrock_server');
    let action = 'flagged for review (no safe auto-command for this server type)';
    if (!isBedrock) {
      try {
        sendCommandToWings(nodeId, uuid, '/kill @e[type=item]');
        action = 'cleared dropped-item lag (/kill @e[type=item])';
      } catch (err) {
        action = `attempted item cleanup but Wings is unreachable (${(err as Error).message})`;
      }
    }

    await logActivity({
      serverId: server.id,
      event: 'server:auto-optimize',
      properties: JSON.stringify({
        reason: cpuTriggered ? 'high_cpu' : 'high_memory',
        avgCpuPercent: Math.round(avgCpu),
        memoryPercent: Math.round(memPct),
        action,
      }),
    }).catch((err: Error) => logger.warn(`Failed to log auto-optimize activity for ${uuid}: ${err.message}`));

    logger.info(`Auto-optimize triggered for ${uuid}: cpu=${avgCpu.toFixed(1)}% mem=${memPct.toFixed(1)}% -> ${action}`);
  })();
}

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
    const handled = ['server:console', 'server:stats', 'server:status', 'server:console:history', 'server:console:clear', 'server:crash', 'server:alert'];
    if (!handled.includes(event)) return;

    // A fresh start on Wings means a fresh console — our own cached buffer
    // (served straight to reconnecting clients without re-asking Wings, see
    // subscribeServerOnWings below) needs to be wiped too, and everyone
    // already viewing the console told to clear their local view, or the
    // previous run's leftover lines just sit there looking current.
    if (event === 'server:console:clear') {
      const clearData = data as { uuid?: string };
      if (clearData.uuid) {
        consoleBuffer.delete(clearData.uuid);
        io.to(`server:uuid:${clearData.uuid}`).emit('server:console:clear', clearData);
      }
      return;
    }

    if (event === 'server:crash' || event === 'server:alert') {
      const alertData = data as { uuid?: string; severity?: string; message?: string };
      if (alertData.uuid) {
        prisma.server.findFirst({ where: { uuid: alertData.uuid }, select: { id: true } })
          .then((server) => {
            if (!server) return;
            return logActivity({
              serverId: server.id,
              event: event === 'server:crash' ? 'server:crash' : 'server:security-alert',
              properties: event === 'server:alert' ? JSON.stringify({ severity: alertData.severity, message: alertData.message }) : '{}',
            });
          })
          .catch((err: Error) => logger.warn(`Failed to log ${event} for ${alertData.uuid}: ${err.message}`));
      }
    }

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
      // Keep DB in sync when Wings confirms a final state. Excludes
      // MIGRATING/RESTORING_BACKUP — those are panel-orchestrated multi-step
      // operations that may stop the container as an intermediate step (e.g.
      // migration stops the server before snapshotting it), and a stray
      // "offline" report from that stop must not be read as "operation done".
      if ((panelStatus === 'RUNNING' || panelStatus === 'OFFLINE') && uuid) {
        prisma.server.updateMany({
          where: { uuid, status: { notIn: ['MIGRATING', 'RESTORING_BACKUP'] } },
          data: { status: panelStatus as 'RUNNING' | 'OFFLINE' },
        }).catch((err: Error) => logger.warn(`Status sync failed for ${uuid}: ${err.message}`));
      }
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
      persistStatSample(uuid, statsEntry);
      checkAutoOptimize(node.id, uuid, statsEntry);

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

  // Idempotent on purpose: every browser tab that opens/reopens a server's
  // console (or reconnects after any brief network blip) calls this. If we
  // re-emitted 'subscribe' to Wings every time, Wings would resend its full
  // log buffer as a fresh server:console:history — which gets broadcast to
  // the whole room and wipes out anything already-connected viewers had
  // accumulated beyond that buffer, looking exactly like console logs
  // randomly disappearing. Only ask Wings again once the underlying node
  // connection itself actually reconnects (handled in the 'connect' handler
  // above, which re-subscribes everything in subscribedUuids from scratch).
  if (conn.subscribedUuids.has(serverUuid)) return;

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
