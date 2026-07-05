import { Readable } from 'stream';
import {
  S3Client, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { StorageAdapter } from './types';

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  prefix?: string;
}

// Covers AWS S3 and every S3-compatible target (Backblaze B2, Cloudflare R2,
// Wasabi, DigitalOcean Spaces, MinIO) through one adapter — they all speak
// the same S3 API, differing only in endpoint/region/path-style.
export class S3Adapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ? `${config.prefix.replace(/\/+$/, '')}/` : '';
    this.client = new S3Client({
      region: config.region || 'auto',
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle ?? false,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async upload(source: Readable, key: string): Promise<{ remotePath: string }> {
    const remotePath = `${this.prefix}${key}`;
    // Upload (not raw PutObjectCommand) handles multipart automatically —
    // backup archives can be many GB and can't be buffered into memory.
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: remotePath, Body: source },
    });
    await upload.done();
    return { remotePath };
  }

  async download(remotePath: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: remotePath }));
    return res.Body as Readable;
  }

  async delete(remotePath: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: remotePath }));
  }

  async testConnection(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
