import { prisma } from '../../utils/prisma';
import { StorageAdapter } from './types';
import { S3Adapter } from './s3';
import { SftpAdapter } from './sftp';
import { GDriveAdapter } from './googleDrive';

export { StorageAdapter } from './types';

export async function getStorageConf(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'storage.' } } });
  const conf: Record<string, string> = {};
  for (const r of rows) conf[r.key] = r.value;
  return conf;
}

// Returns null when no destination is configured, or the selected provider
// is missing required fields — this is what keeps the feature fully
// backward-compatible: every existing install has no storage.* rows, so
// this always returns null and callers skip the cloud step entirely.
export function buildAdapter(conf: Record<string, string>): StorageAdapter | null {
  const provider = conf['storage.provider'];
  if (provider === 's3' && conf['storage.s3.bucket'] && conf['storage.s3.accessKeyId'] && conf['storage.s3.secretAccessKey']) {
    return new S3Adapter({
      endpoint: conf['storage.s3.endpoint'] || undefined,
      region: conf['storage.s3.region'] || 'auto',
      bucket: conf['storage.s3.bucket'],
      accessKeyId: conf['storage.s3.accessKeyId'],
      secretAccessKey: conf['storage.s3.secretAccessKey'],
      forcePathStyle: conf['storage.s3.forcePathStyle'] === 'true',
      prefix: conf['storage.s3.prefix'] || undefined,
    });
  }
  if (provider === 'sftp' && conf['storage.sftp.host'] && conf['storage.sftp.username']) {
    return new SftpAdapter({
      host: conf['storage.sftp.host'],
      port: conf['storage.sftp.port'] ? parseInt(conf['storage.sftp.port'], 10) : undefined,
      username: conf['storage.sftp.username'],
      password: conf['storage.sftp.password'] || undefined,
      privateKey: conf['storage.sftp.privateKey'] || undefined,
      basePath: conf['storage.sftp.basePath'] || undefined,
    });
  }
  if (provider === 'gdrive' && conf['storage.gdrive.serviceAccountJson'] && conf['storage.gdrive.folderId']) {
    return new GDriveAdapter({
      serviceAccountJson: conf['storage.gdrive.serviceAccountJson'],
      folderId: conf['storage.gdrive.folderId'],
    });
  }
  return null;
}

export async function getStorageAdapter(): Promise<StorageAdapter | null> {
  return buildAdapter(await getStorageConf());
}

export function isConfigured(conf: Record<string, string>): boolean {
  return buildAdapter(conf) !== null;
}
