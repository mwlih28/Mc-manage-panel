import { parseExpression } from 'cron-parser';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { sendPowerAction, sendCommand } from './wingsClient';
import { startBackup } from './backupService';
import { Server, Node, Egg, ScheduledTask } from '@prisma/client';

// The Schedule tab has existed for a while as pure CRUD — tasks could be
// created, edited, listed, deleted, but nothing ever actually executed
// them. This is the missing other half: a poller that actually runs due
// tasks against Wings.
const POLL_INTERVAL_MS = 30 * 1000;
// Disruptive power actions (stop/restart) get an in-game warning first so
// players aren't just yanked off — Pterodactyl's own scheduler has no
// equivalent of this.
const PRE_ACTION_WARNING_MS = 30 * 1000;

export function computeNextRun(cronExpression: string, from: Date = new Date()): Date | null {
  try {
    return parseExpression(cronExpression, { currentDate: from }).next().toDate();
  } catch {
    return null;
  }
}

type FullServer = Server & { node: Node | null; egg: Egg };

async function executeTask(task: ScheduledTask): Promise<void> {
  const server = await prisma.server.findUnique({
    where: { id: task.serverId },
    include: { node: true, egg: true },
  }) as FullServer | null;
  if (!server || !server.node) return;

  let payload: unknown;
  try { payload = JSON.parse(task.payload || 'null'); } catch { payload = null; }

  try {
    if (task.action === 'command' && typeof payload === 'string' && payload) {
      await sendCommand(server as Parameters<typeof sendCommand>[0], payload);
    } else if (task.action === 'power' && typeof payload === 'string') {
      const action = payload as 'start' | 'stop' | 'restart' | 'kill';
      if (!['start', 'stop', 'restart', 'kill'].includes(action)) return;
      const isBedrock = server.egg.name.toLowerCase().includes('bedrock') || server.egg.startup.includes('bedrock_server');
      if ((action === 'stop' || action === 'restart') && !isBedrock) {
        const verb = action === 'restart' ? 'restarting' : 'stopping';
        await sendCommand(server as Parameters<typeof sendCommand>[0], `say [Kretase] Server is ${verb} in 30 seconds (scheduled: ${task.name})`).catch(() => {});
        await new Promise((r) => setTimeout(r, PRE_ACTION_WARNING_MS));
      }
      await sendPowerAction(server as Parameters<typeof sendPowerAction>[0], action);
    } else if (task.action === 'backup') {
      const { run } = await startBackup(server, { name: `Scheduled: ${task.name}` });
      await run();
    }
    logger.info(`Scheduled task "${task.name}" ran for server ${server.uuid}`);
  } catch (err) {
    logger.error(`Scheduled task "${task.name}" (${task.id}) failed for server ${server.id}: ${(err as Error).message}`);
  }
}

export function startScheduler(): void {
  // Backfill nextRun for any task that's never had one computed (created
  // before this poller existed, or before a cron expression edit). Scheduled
  // fresh from now rather than "should have run N times already" to avoid a
  // burst of catch-up executions on deploy.
  prisma.scheduledTask.findMany({ where: { enabled: true, nextRun: null } })
    .then((tasks) => Promise.all(tasks.map((t) =>
      prisma.scheduledTask.update({ where: { id: t.id }, data: { nextRun: computeNextRun(t.cronExpression) } })
    )))
    .catch((err) => logger.warn(`Scheduler backfill failed: ${(err as Error).message}`));

  setInterval(async () => {
    const now = new Date();
    let due: ScheduledTask[];
    try {
      due = await prisma.scheduledTask.findMany({ where: { enabled: true, nextRun: { lte: now } } });
    } catch (err) {
      logger.warn(`Scheduler poll failed: ${(err as Error).message}`);
      return;
    }

    for (const task of due) {
      // Recompute nextRun before executing so a slow action (e.g. a backup
      // that takes minutes) can't cause the same task to be picked up again
      // on the very next poll tick.
      await prisma.scheduledTask.update({
        where: { id: task.id },
        data: { lastRun: now, nextRun: computeNextRun(task.cronExpression, now) },
      }).catch(() => {});
      executeTask(task).catch((err) => logger.error(`Scheduled task ${task.id} crashed: ${(err as Error).message}`));
    }
  }, POLL_INTERVAL_MS);

  logger.info('Scheduler started (polling every 30s for due tasks)');
}
