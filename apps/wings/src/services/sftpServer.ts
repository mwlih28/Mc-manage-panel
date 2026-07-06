import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import {
  Server as SSHServer,
  utils as sshUtils,
  Connection,
  AuthContext,
  SFTPWrapper,
  Attributes,
  InputAttributes,
  FileEntry,
} from 'ssh2';
import { FileHandle } from 'fs/promises';
import { getConfig } from '../config';
import { panelClient } from '../services/panelClient';
import { logger } from '../utils/logger';

const { STATUS_CODE, flagsToString } = sshUtils.sftp;

// A stable host key is required so SSH clients don't get a "host key changed"
// warning on every Wings restart. Persisted next to the daemon config.
function getHostKeyPath(): string {
  const etcDir = '/etc/mc-wings';
  if (fs.existsSync(etcDir)) return path.join(etcDir, 'sftp_host_key');
  return path.join(process.cwd(), 'sftp_host_key');
}

function getOrCreateHostKey(): string {
  const keyPath = getHostKeyPath();
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8');

  const { private: privateKey } = sshUtils.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  logger.info(`Generated new SFTP host key at ${keyPath}`);
  return privateKey;
}

// Per-source-IP brute-force throttling at the Wings layer, on top of the
// Panel's own rate limit on the sftp-auth callback.
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isThrottled(ip: string): boolean {
  const entry = authAttempts.get(ip);
  const now = Date.now();
  if (!entry || now > entry.resetAt) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function errnoToStatus(err: NodeJS.ErrnoException): number {
  switch (err.code) {
    case 'ENOENT':
      return STATUS_CODE.NO_SUCH_FILE;
    case 'EACCES':
    case 'EPERM':
      return STATUS_CODE.PERMISSION_DENIED;
    default:
      return STATUS_CODE.FAILURE;
  }
}

function toAttrs(stats: fs.Stats): Attributes {
  return {
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000),
  };
}

function toLongname(name: string, stats: fs.Stats): string {
  const type = stats.isDirectory() ? 'd' : stats.isSymbolicLink() ? 'l' : '-';
  const perm = (stats.mode & 0o777).toString(8).padStart(3, '0');
  const bits = perm
    .split('')
    .map((d) => {
      const n = parseInt(d, 10);
      return `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
    })
    .join('');
  const mtime = new Date(stats.mtimeMs);
  const month = mtime.toLocaleString('en-US', { month: 'short' });
  const day = String(mtime.getDate()).padStart(2, ' ');
  const time = `${String(mtime.getHours()).padStart(2, '0')}:${String(mtime.getMinutes()).padStart(2, '0')}`;
  return `${type}${bits} 1 mc-wings mc-wings ${String(stats.size).padStart(10, ' ')} ${month} ${day} ${time} ${name}`;
}

// Resolves an SFTP-protocol path (client-relative, POSIX style) to a real
// filesystem path inside `root`, throwing if it would escape the root.
function resolveRealPath(root: string, sftpPath: string): string {
  const normalized = path.posix.normalize(`/${sftpPath}`);
  const real = path.join(root, normalized);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error('Path escapes server root');
  }
  return real;
}

function toClientPath(sftpPath: string): string {
  return path.posix.normalize(`/${sftpPath}`);
}

type OpenHandle =
  | { type: 'file'; fh: FileHandle; realPath: string }
  | { type: 'dir'; entries: string[]; realPath: string; offset: number };

function encodeHandle(id: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(id, 0);
  return buf;
}

function decodeHandle(buf: Buffer): number | null {
  if (buf.length !== 4) return null;
  return buf.readUInt32BE(0);
}

async function applyAttrs(target: FileHandle | string, attrs: InputAttributes): Promise<void> {
  const isPath = typeof target === 'string';
  try {
    if (attrs.size !== undefined) {
      if (isPath) await fsp.truncate(target as string, attrs.size);
      else await (target as FileHandle).truncate(attrs.size);
    }
  } catch { /* best-effort */ }
  try {
    if (attrs.mode !== undefined) {
      if (isPath) await fsp.chmod(target as string, attrs.mode);
      else await (target as FileHandle).chmod(attrs.mode);
    }
  } catch { /* best-effort */ }
  try {
    if (attrs.atime !== undefined || attrs.mtime !== undefined) {
      const now = new Date();
      const atime = attrs.atime !== undefined ? attrs.atime : now;
      const mtime = attrs.mtime !== undefined ? attrs.mtime : now;
      if (isPath) await fsp.utimes(target as string, atime, mtime);
      else await (target as FileHandle).utimes(atime, mtime);
    }
  } catch { /* best-effort */ }
}

function handleSftpSession(sftp: SFTPWrapper, root: string): void {
  const openHandles = new Map<number, OpenHandle>();
  let nextHandleId = 1;

  sftp.on('OPEN', (reqid, filename, flags, attrs) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, filename);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    const flagStr = flagsToString(flags);
    if (!flagStr) return sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED);

    fsp.open(realPath, flagStr, attrs.mode ?? 0o644)
      .then((fh) => {
        const id = nextHandleId++;
        openHandles.set(id, { type: 'file', fh, realPath });
        sftp.handle(reqid, encodeHandle(id));
      })
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('READ', (reqid, handleBuf, offset, length) => {
    const id = decodeHandle(handleBuf);
    const entry = id !== null ? openHandles.get(id) : undefined;
    if (!entry || entry.type !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);

    const buffer = Buffer.alloc(length);
    entry.fh.read(buffer, 0, length, offset)
      .then(({ bytesRead }) => {
        if (bytesRead === 0) return sftp.status(reqid, STATUS_CODE.EOF);
        sftp.data(reqid, buffer.subarray(0, bytesRead));
      })
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('WRITE', (reqid, handleBuf, offset, data) => {
    const id = decodeHandle(handleBuf);
    const entry = id !== null ? openHandles.get(id) : undefined;
    if (!entry || entry.type !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);

    entry.fh.write(data, 0, data.length, offset)
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('FSTAT', (reqid, handleBuf) => {
    const id = decodeHandle(handleBuf);
    const entry = id !== null ? openHandles.get(id) : undefined;
    if (!entry || entry.type !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);

    entry.fh.stat()
      .then((stats) => sftp.attrs(reqid, toAttrs(stats)))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('FSETSTAT', (reqid, handleBuf, attrs) => {
    const id = decodeHandle(handleBuf);
    const entry = id !== null ? openHandles.get(id) : undefined;
    if (!entry || entry.type !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);

    applyAttrs(entry.fh, attrs).then(() => sftp.status(reqid, STATUS_CODE.OK));
  });

  sftp.on('CLOSE', (reqid, handleBuf) => {
    const id = decodeHandle(handleBuf);
    const entry = id !== null ? openHandles.get(id) : undefined;
    if (!entry) return sftp.status(reqid, STATUS_CODE.FAILURE);

    openHandles.delete(id as number);
    if (entry.type === 'file') {
      entry.fh.close()
        .then(() => sftp.status(reqid, STATUS_CODE.OK))
        .catch(() => sftp.status(reqid, STATUS_CODE.OK));
    } else {
      sftp.status(reqid, STATUS_CODE.OK);
    }
  });

  sftp.on('OPENDIR', (reqid, dirPath) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, dirPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    fsp.readdir(realPath)
      .then((entries) => {
        const id = nextHandleId++;
        openHandles.set(id, { type: 'dir', entries, realPath, offset: 0 });
        sftp.handle(reqid, encodeHandle(id));
      })
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('READDIR', (reqid, handleBuf) => {
    const id = decodeHandle(handleBuf);
    const entry = id !== null ? openHandles.get(id) : undefined;
    if (!entry || entry.type !== 'dir') return sftp.status(reqid, STATUS_CODE.FAILURE);

    if (entry.offset >= entry.entries.length) {
      return sftp.status(reqid, STATUS_CODE.EOF);
    }

    const names = entry.entries.slice(entry.offset);
    entry.offset = entry.entries.length;

    Promise.all(
      names.map(async (name) => {
        try {
          const stats = await fsp.lstat(path.join(entry.realPath, name));
          const fileEntry: FileEntry = {
            filename: name,
            longname: toLongname(name, stats),
            attrs: toAttrs(stats),
          };
          return fileEntry;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const filtered = results.filter((r): r is FileEntry => r !== null);
      sftp.name(reqid, filtered);
    });
  });

  sftp.on('LSTAT', (reqid, reqPath) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, reqPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    fsp.lstat(realPath)
      .then((stats) => sftp.attrs(reqid, toAttrs(stats)))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('STAT', (reqid, reqPath) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, reqPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    fsp.stat(realPath)
      .then((stats) => sftp.attrs(reqid, toAttrs(stats)))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('REMOVE', (reqid, reqPath) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, reqPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    fsp.unlink(realPath)
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('RMDIR', (reqid, reqPath) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, reqPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    fsp.rmdir(realPath)
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('REALPATH', (reqid, reqPath) => {
    const clientPath = toClientPath(reqPath);
    sftp.name(reqid, [{ filename: clientPath, longname: clientPath, attrs: {} as Attributes }]);
  });

  sftp.on('READLINK', (reqid, reqPath) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, reqPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    fsp.readlink(realPath)
      .then((target) => sftp.name(reqid, [{ filename: target, longname: target, attrs: {} as Attributes }]))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('SETSTAT', (reqid, reqPath, attrs) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, reqPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    applyAttrs(realPath, attrs).then(() => sftp.status(reqid, STATUS_CODE.OK));
  });

  sftp.on('MKDIR', (reqid, reqPath, attrs) => {
    let realPath: string;
    try {
      realPath = resolveRealPath(root, reqPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    fsp.mkdir(realPath, { mode: attrs.mode ?? 0o755 })
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    let oldReal: string, newReal: string;
    try {
      oldReal = resolveRealPath(root, oldPath);
      newReal = resolveRealPath(root, newPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    fsp.rename(oldReal, newReal)
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });

  sftp.on('SYMLINK', (reqid, targetPath, linkPath) => {
    let linkReal: string;
    try {
      linkReal = resolveRealPath(root, linkPath);
    } catch {
      return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }
    // targetPath is stored verbatim (relative symlinks are resolved lazily by
    // whatever reads them); it isn't itself an access-control boundary here
    // since READ/WRITE always re-resolve against `root` regardless of link contents.
    fsp.symlink(targetPath, linkReal)
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch((err) => sftp.status(reqid, errnoToStatus(err)));
  });
}

export function startSftpServer(): void {
  const cfg = getConfig();
  const port = cfg.system.sftp_bind_port || 2022;

  const server = new SSHServer(
    {
      hostKeys: [getOrCreateHostKey()],
      // Identify as OpenSSH-flavored so clients that adaptively pick wire
      // conventions based on the peer's banner (some SFTP libraries,
      // including ssh2 itself in client mode) use the same OpenSSH-compatible
      // field order our SYMLINK handler assumes below. Actual OpenSSH clients
      // and OpenSSH-compatible GUI clients (FileZilla, WinSCP) use that order
      // unconditionally regardless of banner, so this only helps — it never hurts.
      ident: 'OpenSSH_8.9',
    },
    (client: Connection, info) => {
      const ip = info.ip;
      // The serverUuid resolved during authentication is the only thing
      // that determines which directory this connection's SFTP session can touch.
      let authorizedServerUuid: string | null = null;

      client.on('authentication', (ctx: AuthContext) => {
        if (ctx.method !== 'password') {
          return ctx.reject(['password']);
        }

        if (isThrottled(ip)) {
          logger.warn(`SFTP: throttled login attempt from ${ip}`);
          return ctx.reject();
        }

        const dotIndex = ctx.username.lastIndexOf('.');
        if (dotIndex === -1) {
          recordFailedAttempt(ip);
          return ctx.reject();
        }

        panelClient.sftpAuth(ctx.username, ctx.password)
          .then((result) => {
            if (!result) {
              recordFailedAttempt(ip);
              return ctx.reject();
            }
            authorizedServerUuid = result.serverUuid;
            ctx.accept();
          })
          .catch(() => {
            recordFailedAttempt(ip);
            ctx.reject();
          });
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          session.on('sftp', (acceptSftp) => {
            const sftp = acceptSftp();
            if (!authorizedServerUuid) {
              sftp.end();
              return;
            }
            const root = path.join(cfg.system.data, authorizedServerUuid);
            handleSftpSession(sftp, root);
          });
        });
      });

      client.on('close', () => {
        logger.debug(`SFTP client disconnected: ${ip}`);
      });
    }
  );

  server.listen(port, '0.0.0.0', () => {
    logger.info(`SFTP server listening on port ${port}`);
  });
}
