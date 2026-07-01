import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import {
  listWorlds, getActiveWorldName, setActiveWorldName,
  installWorldFromZipFile, createWorldZipStream, deleteFiles,
} from '../services/fileManager';
import { logger } from '../utils/logger';

const router = Router({ mergeParams: true });

// GET /api/servers/:uuid/worlds
router.get('/', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  try {
    const worlds = await listWorlds(uuid);
    return res.json({ worlds, active: getActiveWorldName(uuid) });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// PUT /api/servers/:uuid/worlds/active — switch which world server.properties points at
router.put('/active', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { name } = req.body as { name: string };
  if (!name) return res.status(422).json({ message: 'World name required' });
  try {
    const worlds = await listWorlds(uuid);
    if (!worlds.some(w => w.name === name)) {
      return res.status(404).json({ message: `World "${name}" not found` });
    }
    await setActiveWorldName(uuid, name);
    return res.json({ message: `Active world set to "${name}"` });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/servers/:uuid/worlds/install — download a world zip from a URL and install it
router.post('/install', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { url, name } = req.body as { url: string; name: string };
  if (!url || !name) return res.status(422).json({ message: 'url and name required' });
  if (!url.startsWith('https://')) return res.status(422).json({ message: 'Only HTTPS URLs are allowed' });

  const tmpDir = path.join(os.tmpdir(), `mc_world_dl_${Date.now()}_${uuid}`);
  const tmpFile = path.join(tmpDir, 'world.zip');
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const response = await axios.get<NodeJS.ReadableStream>(url, {
      responseType: 'stream',
      timeout: 120000,
      maxContentLength: 500 * 1024 * 1024,
    });
    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(tmpFile);
      (response.data as NodeJS.ReadableStream).pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    await installWorldFromZipFile(uuid, tmpFile, name);
    logger.info(`World "${name}" installed for ${uuid} from URL`);
    return res.json({ message: `World "${name}" installed` });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// POST /api/servers/:uuid/worlds/upload — upload a world zip directly
const upload = multer({ dest: path.join(os.tmpdir(), 'mc-wings-world-uploads') });
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { name } = req.body as { name: string };
  const file = req.file;
  if (!file) return res.status(422).json({ message: 'No file uploaded' });
  if (!name) {
    fs.unlink(file.path, () => {});
    return res.status(422).json({ message: 'World name required' });
  }
  try {
    await installWorldFromZipFile(uuid, file.path, name);
    logger.info(`World "${name}" installed for ${uuid} from upload`);
    return res.json({ message: `World "${name}" installed` });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  } finally {
    fs.unlink(file.path, () => {});
  }
});

// GET /api/servers/:uuid/worlds/:name/download — stream a world as a zip
router.get('/:name/download', (req: Request, res: Response) => {
  const { uuid, name } = req.params;
  try {
    const archive = createWorldZipStream(uuid, name);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
    archive.pipe(res);
    archive.on('error', (err) => {
      logger.error(`World zip stream error for ${uuid}/${name}: ${err.message}`);
      res.destroy();
    });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
});

// DELETE /api/servers/:uuid/worlds/:name — delete a world folder (cannot delete active world)
router.delete('/:name', async (req: Request, res: Response) => {
  const { uuid, name } = req.params;
  try {
    if (getActiveWorldName(uuid) === name) {
      return res.status(400).json({ message: 'Cannot delete the active world. Switch to another world first.' });
    }
    const worlds = await listWorlds(uuid);
    if (!worlds.some(w => w.name === name)) {
      return res.status(404).json({ message: `World "${name}" not found` });
    }
    await deleteFiles(uuid, [name]);
    return res.json({ message: `World "${name}" deleted` });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

export default router;
