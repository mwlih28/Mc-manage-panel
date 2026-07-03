import axios from 'axios';
import { Server, Node, Allocation } from '@prisma/client';
import { logger } from '../utils/logger';

export interface LiveServerStatus {
  online: boolean;
  playerCount: number;
  maxPlayers: number | null;
  motd: string | null;
  address: string | null;
}

// Shared by the public status page (unauthenticated) and the owner-facing
// customization preview (authenticated) so both show the exact same numbers
// instead of two slightly-different implementations drifting apart.
export async function getLiveServerStatus(
  server: Server & { node: Node | null; allocation: Allocation | null }
): Promise<LiveServerStatus> {
  const result: LiveServerStatus = {
    online: false,
    playerCount: 0,
    maxPlayers: null,
    motd: null,
    address: server.allocation && server.node ? `${server.node.fqdn}:${server.allocation.port}` : null,
  };

  if (!server.node) return result;

  const client = axios.create({
    baseURL: `${server.node.scheme}://${server.node.fqdn}:${server.node.daemonPort}/api`,
    headers: { Authorization: `Bearer ${server.node.token}` },
    timeout: 5000,
  });

  try {
    const [statusRes, playersRes, propsRes] = await Promise.allSettled([
      client.get(`/servers/${server.uuid}/status`),
      client.get(`/servers/${server.uuid}/players`),
      client.get(`/servers/${server.uuid}/files/contents`, { params: { file: 'server.properties' } }),
    ]);

    if (statusRes.status === 'fulfilled') {
      result.online = statusRes.value.data.status === 'running';
    }
    if (playersRes.status === 'fulfilled') {
      result.playerCount = playersRes.value.data.count ?? playersRes.value.data.players?.length ?? 0;
    }
    if (propsRes.status === 'fulfilled') {
      const content: string = propsRes.value.data.content || '';
      const motdMatch = content.match(/^motd=(.*)$/m);
      const maxMatch = content.match(/^max-players=(\d+)$/m);
      if (motdMatch) result.motd = motdMatch[1].replace(/\\u00a7[0-9a-fk-or]/gi, '').trim();
      if (maxMatch) result.maxPlayers = parseInt(maxMatch[1], 10);
    }
  } catch (err) {
    logger.warn(`Live status lookup failed for ${server.uuid}: ${(err as Error).message}`);
  }

  return result;
}
