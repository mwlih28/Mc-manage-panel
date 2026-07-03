import { Router, Request, Response } from 'express';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createBackup, restoreBackup, deleteBackupFile, getBackupFilePath } from '../services/fileManager';
import { logger } from '../utils/logger';

const router = Router({ mergeParams: true });

// POST /api/servers/:uuid/backups — archives the server directory into a
// tar.gz keyed by backupUuid. Synchronous from the panel's point of view
// (the panel calls this from a detached promise, not inline in its own
// HTTP response) since archiving a large world can take a while.
router.post('/', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { backupUuid, ignoredFiles } = req.body;
  if (!backupUuid) return res.status(422).json({ message: 'backupUuid is required' });

  try {
    const { size, checksum } = await createBackup(uuid, backupUuid, ignoredFiles || []);
    return res.json({ size, checksum });
  } catch (err) {
    logger.error(`Backup failed for server ${uuid}: ${(err as Error).message}`);
    return res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/servers/:uuid/backups/:backupUuid/restore
router.post('/:backupUuid/restore', async (req: Request, res: Response) => {
  const { uuid, backupUuid } = req.params;
  try {
    await restoreBackup(uuid, backupUuid);
    return res.json({ message: 'Restored' });
  } catch (err) {
    logger.error(`Restore failed for server ${uuid}: ${(err as Error).message}`);
    return res.status(500).json({ message: (err as Error).message });
  }
});

// GET /api/servers/:uuid/backups/:backupUuid/download — streams the raw
// archive, used both for the "download backup" button and for cross-node
// migration (the panel fetches it from here and re-uploads it to the
// destination node's upload-restore endpoint below).
router.get('/:backupUuid/download', (req: Request, res: Response) => {
  const { uuid, backupUuid } = req.params;
  const filePath = getBackupFilePath(uuid, backupUuid);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Backup file not found' });
  return res.download(filePath, `${backupUuid}.tar.gz`);
});

// POST /api/servers/:uuid/backups/:backupUuid/upload — accepts a raw
// tar.gz body (piped from another node's download endpoint) and restores
// it directly, so cross-node migration never needs the archive to land on
// the panel's own disk in between.
router.post('/:backupUuid/upload', express.raw({ type: '*/*', limit: '10gb' }), async (req: Request, res: Response) => {
  const { uuid, backupUuid } = req.params;
  try {
    const filePath = getBackupFilePath(uuid, backupUuid);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.body);
    await restoreBackup(uuid, backupUuid);
    return res.json({ message: 'Restored from upload' });
  } catch (err) {
    logger.error(`Upload-restore failed for server ${uuid}: ${(err as Error).message}`);
    return res.status(500).json({ message: (err as Error).message });
  }
});

// DELETE /api/servers/:uuid/backups/:backupUuid
router.delete('/:backupUuid', (req: Request, res: Response) => {
  const { uuid, backupUuid } = req.params;
  deleteBackupFile(uuid, backupUuid);
  return res.status(204).send();
});

export default router;
