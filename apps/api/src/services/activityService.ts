import { prisma } from '../utils/prisma';
import { dispatchWebhooks } from './webhookDispatch';

interface LogActivityInput {
  userId?: string;
  serverId?: string;
  event: string;
  properties?: string;
  ip?: string;
}

// Single entry point for recording an Activity row. Behavior is identical
// to the raw prisma.activity.create(...) calls this replaces — webhooks are
// dispatched fire-and-forget afterward so a slow/failing receiver can never
// delay or break the caller, and the event is already durably logged
// regardless of delivery outcome.
export async function logActivity(input: LogActivityInput) {
  const activity = await prisma.activity.create({ data: input });
  dispatchWebhooks(input.event, {
    serverId: input.serverId,
    userId: input.userId,
    properties: input.properties,
  }).catch(() => {});
  return activity;
}
