import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';
import { StorageAdapter } from './types';

export interface GDriveConfig {
  // Full JSON key downloaded when creating a Google Cloud service account.
  serviceAccountJson: string;
  // The Drive folder (shared with the service account's email) backups are uploaded into.
  folderId: string;
}

// Uses a service-account key rather than interactive OAuth — backups run as
// an unattended background job with no user present to grant consent.
export class GDriveAdapter implements StorageAdapter {
  private drive: drive_v3.Drive;
  private folderId: string;

  constructor(config: GDriveConfig) {
    let key: { client_email: string; private_key: string };
    try {
      key = JSON.parse(config.serviceAccountJson);
    } catch {
      throw new Error('Google Drive service account JSON is not valid JSON');
    }
    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    this.drive = google.drive({ version: 'v3', auth });
    this.folderId = config.folderId;
  }

  // Drive addresses files by an opaque id, not a path — the returned id
  // becomes this backup's remotePath.
  async upload(source: Readable, key: string): Promise<{ remotePath: string }> {
    const res = await this.drive.files.create({
      requestBody: { name: key.replace(/\//g, '_'), parents: [this.folderId] },
      media: { mimeType: 'application/gzip', body: source },
      fields: 'id',
    });
    if (!res.data.id) throw new Error('Google Drive upload did not return a file id');
    return { remotePath: res.data.id };
  }

  async download(remotePath: string): Promise<Readable> {
    const res = await this.drive.files.get(
      { fileId: remotePath, alt: 'media' },
      { responseType: 'stream' },
    );
    return res.data as unknown as Readable;
  }

  async delete(remotePath: string): Promise<void> {
    await this.drive.files.delete({ fileId: remotePath });
  }

  async testConnection(): Promise<void> {
    await this.drive.files.list({ pageSize: 1, fields: 'files(id)' });
  }
}
