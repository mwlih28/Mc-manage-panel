import { Server, Node, Egg, Nest } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { sendPowerAction } from './wingsClient';
import { logActivity } from './activityService';
import { logger } from '../utils/logger';

export type PowerAction = 'start' | 'stop' | 'restart' | 'kill';

export interface PowerActionResult {
  ok: boolean;
  message: string;
  code?: 'EULA_NOT_ACCEPTED' | 'INVALID_ACTION';
}

type ServerWithNodeEgg = Server & { node: Node | null; egg: Egg & { nest: Nest | null } };

// Shared by the HTTP power route and the Discord bot's /start /stop /restart
// commands so both call the exact same validation + Wings dispatch + activity
// log, instead of the bot duplicating (and inevitably drifting from) the
// route's logic.
export async function performPowerAction(
  server: ServerWithNodeEgg,
  action: string,
  actor: { userId?: string; ip?: string; label?: string }
): Promise<PowerActionResult> {
  if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
    return { ok: false, message: 'Invalid power action', code: 'INVALID_ACTION' };
  }

  const isMinecraftEgg = server.egg.nest?.name === 'Minecraft';
  const isBedrockEgg = server.egg.name.toLowerCase().includes('bedrock') || server.egg.startup.includes('bedrock_server');
  if (action === 'start' && isMinecraftEgg && !isBedrockEgg && !server.eulaAccepted) {
    // The web UI matches on this exact message string to trigger the EULA
    // modal (ServerDetailPage.tsx) — keep it literal, don't humanize it.
    return { ok: false, message: 'EULA_NOT_ACCEPTED', code: 'EULA_NOT_ACCEPTED' };
  }

  const statusMap: Record<string, string> = {
    start: 'STARTING',
    stop: 'STOPPING',
    restart: 'STOPPING',
    kill: 'OFFLINE',
  };

  await prisma.server.update({
    where: { id: server.id },
    data: { status: statusMap[action] as 'STARTING' | 'STOPPING' | 'OFFLINE' },
  });

  if (server.node?.status === 'ONLINE') {
    sendPowerAction(server as Parameters<typeof sendPowerAction>[0], action as PowerAction)
      .catch((err) => logger.warn(`Wings power action failed for ${server.uuid}: ${err.message}`));
  } else {
    logger.warn(`Node is offline, power action queued for ${server.uuid}`);
  }

  await logActivity({
    userId: actor.userId,
    serverId: server.id,
    event: `server:power.${action}`,
    properties: actor.label ? JSON.stringify({ via: actor.label }) : undefined,
    ip: actor.ip,
  });

  return { ok: true, message: `Server ${action} command sent` };
}
