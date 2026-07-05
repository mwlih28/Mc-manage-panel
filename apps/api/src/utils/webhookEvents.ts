export interface WebhookEventDef {
  key: string;
  label: string;
  category: string;
}

// Mirrors the Activity.event strings already used across the codebase —
// deliberately not a separate taxonomy, so adding a new logActivity() call
// site automatically has a matching webhook event without extra bookkeeping.
export const WEBHOOK_EVENTS: WebhookEventDef[] = [
  { key: 'server:create', label: 'Server created', category: 'Server' },
  { key: 'server:delete', label: 'Server deleted', category: 'Server' },
  { key: 'server:suspend', label: 'Server suspended/unsuspended', category: 'Server' },
  { key: 'server:reinstall', label: 'Server reinstalled', category: 'Server' },
  { key: 'server:migrate', label: 'Server migrated to another node', category: 'Server' },
  { key: 'server:clone', label: 'Server cloned', category: 'Server' },
  { key: 'server:modpack-install', label: 'Modpack installed', category: 'Server' },
  { key: 'server:power.*', label: 'Power action (start/stop/restart/kill)', category: 'Server' },
  { key: 'server:crash', label: 'Server crashed', category: 'Alerts' },
  { key: 'server:security-alert', label: 'Suspicious activity detected', category: 'Alerts' },
  { key: 'server:auto-optimize', label: 'Auto-optimize triggered', category: 'Alerts' },
  { key: 'server:backup.start', label: 'Backup started', category: 'Backups' },
  { key: 'server:backup.complete', label: 'Backup completed', category: 'Backups' },
  { key: 'server:backup.failed', label: 'Backup failed', category: 'Backups' },
  { key: 'server:backup.restore', label: 'Backup restored', category: 'Backups' },
  { key: 'user:create', label: 'User created', category: 'Users' },
  { key: 'user:delete', label: 'User deleted', category: 'Users' },
  { key: 'auth:login', label: 'User logged in', category: 'Users' },
];

// Matches a concrete event (e.g. "server:power.start") against a granted
// pattern: exact match, "*" for everything, or a "prefix.*" wildcard.
export function eventMatches(pattern: string, event: string): boolean {
  if (pattern === '*') return true;
  if (pattern === event) return true;
  if (pattern.endsWith('.*') && event.startsWith(pattern.slice(0, -1))) return true;
  return false;
}
