import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { getNodeSystemInfo } from './wingsClient';
import { dispatchAdminPush } from './pushDispatch';
import { logActivity } from './activityService';

// Disk space is the classic silent-failure mode on a self-hosted node — a
// full disk corrupts worlds and crash-loops servers with zero warning in the
// panel today (Node.disk is only the admin-configured allocatable amount,
// never the host's actual usage). This polls each node's real disk usage and
// alerts once per threshold crossing rather than on a fixed schedule, since
// "still at 96%" every 5 minutes would just be spam.
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const WARNING_PCT = 85;
const CRITICAL_PCT = 95;

type AlertLevel = 'ok' | 'warning' | 'critical';

function levelFor(pct: number): AlertLevel {
  if (pct >= CRITICAL_PCT) return 'critical';
  if (pct >= WARNING_PCT) return 'warning';
  return 'ok';
}

async function checkNode(node: { id: string; name: string; fqdn: string; daemonPort: number; scheme: string; token: string; diskAlertLevel: string }) {
  let info;
  try {
    info = await getNodeSystemInfo(node.fqdn, node.daemonPort, node.scheme, node.token);
  } catch {
    // Node unreachable — the existing node-status health check already
    // surfaces that; nothing new to report here.
    return;
  }
  const disk = info.primaryDisk;
  if (!disk) return;

  await prisma.node.update({
    where: { id: node.id },
    data: {
      diskUsedBytes: BigInt(Math.round(disk.used)),
      diskTotalBytes: BigInt(Math.round(disk.size)),
      diskCheckedAt: new Date(),
    },
  }).catch(() => {});

  const newLevel = levelFor(disk.usedPercent);
  const prevLevel = node.diskAlertLevel as AlertLevel;
  if (newLevel === prevLevel) return;

  await prisma.node.update({ where: { id: node.id }, data: { diskAlertLevel: newLevel } }).catch(() => {});

  const pctStr = `${disk.usedPercent.toFixed(1)}%`;
  if (newLevel === 'critical') {
    await dispatchAdminPush('Node disk almost full', `${node.name} is at ${pctStr} disk usage — servers may crash or fail to save.`).catch(() => {});
    await logActivity({ event: 'node:disk-critical', properties: JSON.stringify({ nodeId: node.id, nodeName: node.name, usedPercent: disk.usedPercent }) }).catch(() => {});
  } else if (newLevel === 'warning') {
    await dispatchAdminPush('Node disk usage high', `${node.name} is at ${pctStr} disk usage.`).catch(() => {});
    await logActivity({ event: 'node:disk-warning', properties: JSON.stringify({ nodeId: node.id, nodeName: node.name, usedPercent: disk.usedPercent }) }).catch(() => {});
  } else if (prevLevel !== 'ok') {
    // Recovered from warning/critical back under threshold.
    await dispatchAdminPush('Node disk usage back to normal', `${node.name} is now at ${pctStr} disk usage.`).catch(() => {});
    await logActivity({ event: 'node:disk-recovered', properties: JSON.stringify({ nodeId: node.id, nodeName: node.name, usedPercent: disk.usedPercent }) }).catch(() => {});
  }
}

export function startNodeMonitor(): void {
  setInterval(async () => {
    let nodes;
    try {
      nodes = await prisma.node.findMany({
        select: { id: true, name: true, fqdn: true, daemonPort: true, scheme: true, token: true, diskAlertLevel: true },
      });
    } catch (err) {
      logger.warn(`Node monitor poll failed: ${(err as Error).message}`);
      return;
    }

    for (const node of nodes) {
      checkNode(node).catch((err) =>
        logger.warn(`Disk check failed for node ${node.name}: ${(err as Error).message}`)
      );
    }
  }, POLL_INTERVAL_MS);

  logger.info('Node disk monitor started (polling every 5m)');
}
