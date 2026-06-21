import axios, { AxiosInstance } from 'axios';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import type { ServerConfig, ServerStatus } from '../types';

class PanelClient {
  private client: AxiosInstance | null = null;

  private getClient(): AxiosInstance {
    if (this.client) return this.client;
    const cfg = getConfig();
    this.client = axios.create({
      baseURL: `${cfg.remote}/api/v1/wings`,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
        'X-Wings-Node': cfg.uuid,
      },
      timeout: 10000,
    });
    return this.client;
  }

  async authenticate(): Promise<{ nodeId: string; name: string }> {
    const client = this.getClient();
    const { data } = await client.post('/auth');
    return data;
  }

  async getServers(): Promise<ServerConfig[]> {
    const client = this.getClient();
    const { data } = await client.get('/servers');
    return data.servers || [];
  }

  async reportStatus(serverUuid: string, status: ServerStatus): Promise<void> {
    const client = this.getClient();
    await client.post(`/servers/${serverUuid}/status`, { status: status.toUpperCase() }).catch(() => {});
  }

  async reportHeartbeat(load: {
    cpu: number;
    memory: number;
    disk: number;
  }): Promise<void> {
    const client = this.getClient();
    await client.post('/heartbeat', { load }).catch(() => {});
  }
}

export const panelClient = new PanelClient();
