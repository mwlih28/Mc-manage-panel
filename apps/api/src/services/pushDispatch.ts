import webpush from 'web-push';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

// Only a curated set of events are worth an OS-level notification — every
// Activity event going to push would be spam. This is the actual point of
// the feature: being able to react to a crash/alert without a tab open.
const PUSH_EVENTS = new Set(['server:crash', 'server:security-alert', 'server:suspend']);

const EVENT_TITLES: Record<string, string> = {
  'server:crash': 'Server crashed',
  'server:security-alert': 'Suspicious activity detected',
  'server:suspend': 'Server suspended',
};

let vapidReady: Promise<{ publicKey: string; privateKey: string }> | null = null;

// VAPID keys are generated once on first use and persisted — there's no
// admin-facing concept of "configure your push keys," this should just work
// out of the box the same way JWT secrets are provisioned at install time.
async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (!vapidReady) {
    vapidReady = (async () => {
      const rows = await prisma.setting.findMany({ where: { key: { in: ['push.vapidPublicKey', 'push.vapidPrivateKey'] } } });
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (map['push.vapidPublicKey'] && map['push.vapidPrivateKey']) {
        return { publicKey: map['push.vapidPublicKey'], privateKey: map['push.vapidPrivateKey'] };
      }
      const generated = webpush.generateVAPIDKeys();
      await prisma.setting.upsert({ where: { key: 'push.vapidPublicKey' }, update: { value: generated.publicKey }, create: { key: 'push.vapidPublicKey', value: generated.publicKey } });
      await prisma.setting.upsert({ where: { key: 'push.vapidPrivateKey' }, update: { value: generated.privateKey }, create: { key: 'push.vapidPrivateKey', value: generated.privateKey } });
      return generated;
    })();
  }
  return vapidReady;
}

export async function getVapidPublicKey(): Promise<string> {
  return (await getVapidKeys()).publicKey;
}

// For alerts that belong to the infrastructure itself rather than one
// server/owner (e.g. a node's disk filling up) — notifies every admin's
// push subscriptions directly instead of resolving from a serverId.
export async function dispatchAdminPush(title: string, body: string): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  if (admins.length === 0) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: { in: admins.map((a) => a.id) } } });
  if (subscriptions.length === 0) return;

  const { publicKey, privateKey } = await getVapidKeys();
  const payload = JSON.stringify({ title, body });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { vapidDetails: { subject: 'mailto:admin@kretase.local', publicKey, privateKey } }
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        logger.warn(`Admin push delivery failed for subscription ${sub.id}: ${(err as Error).message}`);
      }
    }
  }
}

// Notifies the server's owner, resolved from serverId — not the caller's own
// userId, which for some events (e.g. an admin suspending someone else's
// server) is the actor, not the person who actually needs to know.
export async function dispatchPush(event: string, serverId: string | null | undefined, properties?: string): Promise<void> {
  if (!serverId || !PUSH_EVENTS.has(event)) return;

  const server = await prisma.server.findUnique({ where: { id: serverId }, select: { userId: true, name: true } });
  if (!server) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: server.userId } });
  if (subscriptions.length === 0) return;

  const { publicKey, privateKey } = await getVapidKeys();
  const title = EVENT_TITLES[event] || event;
  let detail = '';
  try {
    const props = properties ? JSON.parse(properties) : null;
    if (event === 'server:security-alert' && props?.message) detail = `: ${props.message}`;
    else if (event === 'server:suspend') detail = props?.suspended === false ? ' (unsuspended)' : '';
  } catch { /* keep detail empty */ }
  const body = `${server.name}${detail}`;

  const payload = JSON.stringify({ title, body, serverId });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { vapidDetails: { subject: 'mailto:admin@kretase.local', publicKey, privateKey } }
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Subscription expired or was revoked by the browser — clean it up
        // rather than retrying it forever.
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        logger.warn(`Push delivery failed for subscription ${sub.id}: ${(err as Error).message}`);
      }
    }
  }
}
