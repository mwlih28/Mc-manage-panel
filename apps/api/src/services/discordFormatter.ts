// Colors match the panel's own .badge-* classes (apps/web/src/index.css) so
// a Discord notification visually matches what an admin would see in-app.
const COLOR = {
  green: parseInt('3EC896', 16),
  red: parseInt('F27074', 16),
  amber: parseInt('F0B93D', 16),
  blue: parseInt('60A5FA', 16),
  gray: parseInt('9A9CA3', 16),
};

function colorFor(event: string): number {
  if (/create|complete|restore|login/.test(event)) return COLOR.green;
  if (/delete|crash|failed/.test(event)) return COLOR.red;
  if (/suspend|security-alert|auto-optimize/.test(event)) return COLOR.amber;
  if (/power|migrate|clone|reinstall|modpack/.test(event)) return COLOR.blue;
  return COLOR.gray;
}

export interface DiscordFormatterContext {
  server?: { id: string; name: string; uuid: string } | null;
  user?: { id: string; username?: string; email?: string } | null;
  properties?: Record<string, unknown>;
}

export function formatDiscordPayload(event: string, ctx: DiscordFormatterContext) {
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (ctx.server) fields.push({ name: 'Server', value: ctx.server.name, inline: true });
  if (ctx.user?.username || ctx.user?.email) {
    fields.push({ name: 'User', value: ctx.user.username || ctx.user.email || 'unknown', inline: true });
  }
  for (const [key, value] of Object.entries(ctx.properties || {})) {
    if (value === undefined || value === null) continue;
    fields.push({ name: key, value: String(value), inline: true });
  }

  return {
    embeds: [
      {
        title: event,
        description: `Event fired on Kretase`,
        color: colorFor(event),
        timestamp: new Date().toISOString(),
        fields,
      },
    ],
  };
}
