import { Readable } from 'stream';

export interface StorageAdapter {
  /** Uploads a stream under `key`, returning the backend-specific path/id to persist on the Backup row. */
  upload(source: Readable, key: string): Promise<{ remotePath: string }>;
  download(remotePath: string): Promise<Readable>;
  delete(remotePath: string): Promise<void>;
  /** Throws with a human-readable message on failure — used by the admin "Test Connection" button. */
  testConnection(): Promise<void>;
}

export type StorageProvider = 's3' | 'sftp' | 'gdrive';
