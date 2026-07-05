import { API_KEY_SCOPES, ApiKeyScope } from './apiKeys';

export interface ApiManifestEntry {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  scope: ApiKeyScope | ApiKeyScope[];
  description: string;
}

// Hand-curated list of routes meant for third-party integration (billing
// systems, automation, Zapier/n8n-style tools) — not every internal or
// Wings-proxy route, just the ones an integrator actually needs. Kept in
// sync with API_KEY_SCOPES via a test (see apiManifest.test.ts).
export const API_MANIFEST: ApiManifestEntry[] = [
  { method: 'GET', path: '/servers', scope: 'servers:read', description: 'List servers' },
  { method: 'GET', path: '/servers/:id', scope: 'servers:read', description: 'Get a server' },
  { method: 'POST', path: '/servers', scope: 'servers:write', description: 'Create a server' },
  { method: 'PATCH', path: '/servers/:id', scope: 'servers:write', description: 'Update a server (including suspend/unsuspend)' },
  { method: 'DELETE', path: '/servers/:id', scope: 'servers:write', description: 'Delete a server' },
  { method: 'POST', path: '/servers/:id/power', scope: ['servers:power', 'servers:write'], description: 'Send a power action (start/stop/restart/kill)' },
  { method: 'POST', path: '/servers/:id/command', scope: ['servers:power', 'servers:write'], description: 'Send a console command' },
  { method: 'GET', path: '/servers/:id/resources', scope: 'servers:read', description: 'Get live CPU/RAM/disk usage' },
  { method: 'GET', path: '/servers/:serverId/backups', scope: 'servers:read', description: 'List backups' },
  { method: 'POST', path: '/servers/:serverId/backups', scope: 'servers:write', description: 'Create a backup' },
  { method: 'DELETE', path: '/servers/:serverId/backups/:backupId', scope: 'servers:write', description: 'Delete a backup' },
  { method: 'POST', path: '/servers/:serverId/backups/:backupId/restore', scope: 'servers:write', description: 'Restore a backup' },
  { method: 'GET', path: '/users', scope: 'users:read', description: 'List users' },
  { method: 'GET', path: '/users/:id', scope: 'users:read', description: 'Get a user' },
  { method: 'POST', path: '/users', scope: 'users:write', description: 'Create a user' },
  { method: 'PATCH', path: '/users/:id', scope: 'users:write', description: 'Update a user' },
  { method: 'DELETE', path: '/users/:id', scope: 'users:write', description: 'Delete a user' },
  { method: 'GET', path: '/nodes', scope: 'nodes:read', description: 'List nodes' },
  { method: 'GET', path: '/nodes/:id', scope: 'nodes:read', description: 'Get a node' },
  { method: 'GET', path: '/eggs', scope: 'eggs:read', description: 'List eggs' },
  { method: 'GET', path: '/eggs/:id', scope: 'eggs:read', description: 'Get an egg' },
];

// Fails loudly (at require-time, and via a test) if a manifest entry
// references a scope that was renamed/removed, so the two can't drift.
for (const entry of API_MANIFEST) {
  const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope];
  for (const s of scopes) {
    if (!(API_KEY_SCOPES as readonly string[]).includes(s)) {
      throw new Error(`apiManifest.ts: unknown scope "${s}" for ${entry.method} ${entry.path}`);
    }
  }
}
