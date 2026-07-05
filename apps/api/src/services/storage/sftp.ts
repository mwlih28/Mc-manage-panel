import { PassThrough, Readable } from 'stream';
import SftpClient from 'ssh2-sftp-client';
import { StorageAdapter } from './types';

export interface SftpConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  basePath?: string;
}

export class SftpAdapter implements StorageAdapter {
  private basePath: string;

  constructor(private config: SftpConfig) {
    this.basePath = config.basePath ? config.basePath.replace(/\/+$/, '') : '';
  }

  private resolve(key: string): string {
    return this.basePath ? `${this.basePath}/${key}` : key;
  }

  private async connect(): Promise<SftpClient> {
    const client = new SftpClient();
    await client.connect({
      host: this.config.host,
      port: this.config.port || 22,
      username: this.config.username,
      password: this.config.password || undefined,
      privateKey: this.config.privateKey || undefined,
    });
    return client;
  }

  async upload(source: Readable, key: string): Promise<{ remotePath: string }> {
    const remotePath = this.resolve(key);
    const client = await this.connect();
    try {
      const dir = remotePath.slice(0, remotePath.lastIndexOf('/'));
      if (dir) await client.mkdir(dir, true).catch(() => {});
      await client.put(source, remotePath);
      return { remotePath };
    } finally {
      await client.end();
    }
  }

  // ssh2-sftp-client's get() buffers the whole file into memory unless given
  // a destination stream — a multi-GB backup archive can't be buffered, so
  // we hand it a PassThrough and return it immediately rather than awaiting
  // the transfer inline.
  async download(remotePath: string): Promise<Readable> {
    const client = await this.connect();
    const passthrough = new PassThrough();
    client.get(remotePath, passthrough)
      .catch((err) => passthrough.destroy(err))
      .finally(() => { client.end().catch(() => {}); });
    return passthrough;
  }

  async delete(remotePath: string): Promise<void> {
    const client = await this.connect();
    try {
      await client.delete(remotePath);
    } finally {
      await client.end();
    }
  }

  async testConnection(): Promise<void> {
    const client = await this.connect();
    try {
      await client.list(this.basePath || '.');
    } finally {
      await client.end();
    }
  }
}
