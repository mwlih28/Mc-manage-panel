import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getConfig } from '../config';
import {
  listDirectory, readFile, writeFile, deleteFiles,
  createDirectory, renameFile, getServerRoot, safePath,
} from '../services/fileManager';
import { curseForgeFingerprint } from '../utils/murmur2';

const router = Router({ mergeParams: true });

// GET /api/servers/:uuid/files?directory=/
router.get('/', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const dir = (req.query.directory as string) || '/';
  try {
    const files = await listDirectory(uuid, dir);
    return res.json({ files });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// GET /api/servers/:uuid/files/contents?file=server.properties
router.get('/contents', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const filePath = (req.query.file as string) || '';
  if (!filePath) return res.status(422).json({ message: 'File path required' });
  try {
    const content = await readFile(uuid, filePath);
    return res.json({ content });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/servers/:uuid/files/write
router.post('/write', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { file, content, encoding } = req.body;
  if (!file) return res.status(422).json({ message: 'File path required' });
  try {
    await writeFile(uuid, file, content || '', encoding === 'base64' ? 'base64' : 'utf8');
    return res.json({ message: 'File saved' });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/servers/:uuid/files/delete
router.post('/delete', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { files } = req.body;
  if (!Array.isArray(files)) return res.status(422).json({ message: 'Files array required' });
  try {
    await deleteFiles(uuid, files);
    return res.json({ message: 'Files deleted' });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/servers/:uuid/files/create-folder
router.post('/create-folder', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { name, directory = '/' } = req.body;
  try {
    await createDirectory(uuid, path.join(directory, name));
    return res.json({ message: 'Directory created' });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// PUT /api/servers/:uuid/files/rename
router.put('/rename', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { from, to } = req.body;
  try {
    await renameFile(uuid, from, to);
    return res.json({ message: 'File renamed' });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// File upload
const upload = multer({ dest: '/tmp/mc-wings-uploads/' });
router.post('/upload', upload.array('files'), async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const dir = (req.query.directory as string) || '/';
  const cfg = getConfig();
  const root = path.join(cfg.system.data, uuid);

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) return res.status(422).json({ message: 'No files uploaded' });

  for (const file of files) {
    const destDir = path.join(root, dir);
    const destPath = path.join(destDir, file.originalname);
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(file.path, destPath);
  }

  return res.json({ message: `${files.length} file(s) uploaded` });
});

// GET /api/servers/:uuid/files/hashes?directory=/plugins — computes SHA1
// (Modrinth) and CurseForge's fingerprint hash for each .jar in a
// directory, so the panel can identify installed plugins/mods that don't
// have a Kretase-written manifest entry (manually uploaded, or predating
// the manifest) without ever streaming the jar bytes through the panel.
router.get('/hashes', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const dir = (req.query.directory as string) || '/';
  try {
    const root = getServerRoot(uuid);
    const target = safePath(root, dir);
    if (!fs.existsSync(target)) return res.json({ files: [] });

    const jars = fs.readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.jar'));

    const files = jars.map((entry) => {
      const filePath = path.join(target, entry.name);
      const buffer = fs.readFileSync(filePath);
      return {
        name: entry.name,
        size: buffer.length,
        sha1: crypto.createHash('sha1').update(buffer).digest('hex'),
        murmur2: curseForgeFingerprint(buffer),
      };
    });

    return res.json({ files });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// Download file
router.get('/download', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const filePath = (req.query.file as string) || '';
  if (!filePath) return res.status(422).json({ message: 'File path required' });
  const cfg = getConfig();
  const root = path.join(cfg.system.data, uuid);
  const target = path.resolve(root, filePath.replace(/^\/+/, ''));
  if (!target.startsWith(root)) return res.status(403).json({ message: 'Forbidden' });
  if (!fs.existsSync(target)) return res.status(404).json({ message: 'File not found' });
  return res.download(target);
});

export default router;
