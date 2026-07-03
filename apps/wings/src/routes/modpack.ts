import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getServerRoot, safePath } from '../services/fileManager';
import { logger } from '../utils/logger';

const router = Router({ mergeParams: true });

// POST /api/servers/:uuid/modpack/overrides — writes a modpack's bundled
// config/resourcepack/etc. files onto the server. The panel already
// extracted these from the .mrpack/CurseForge zip and base64-encodes them
// since they're typically small text/config files, unlike the mod jars
// (which are downloaded directly by Wings below instead of round-tripping
// through the panel).
router.post('/overrides', (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { files } = req.body as { files: { path: string; contentBase64: string }[] };
  if (!Array.isArray(files)) return res.status(422).json({ message: 'files array required' });

  const root = getServerRoot(uuid);
  fs.mkdirSync(root, { recursive: true });
  let written = 0;
  const failed: { path: string; error: string }[] = [];

  for (const f of files) {
    try {
      const target = safePath(root, f.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(f.contentBase64, 'base64'));
      written++;
    } catch (err) {
      failed.push({ path: f.path, error: (err as Error).message });
    }
  }

  return res.json({ written, failed });
});

// POST /api/servers/:uuid/modpack/mods — downloads a list of mod jars
// (resolved by the panel from CurseForge/Modrinth) directly onto the
// server, bypassing the panel entirely for the actual file bytes.
router.post('/mods', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { mods } = req.body as { mods: { url: string; path: string }[] };
  if (!Array.isArray(mods)) return res.status(422).json({ message: 'mods array required' });

  const root = getServerRoot(uuid);
  fs.mkdirSync(root, { recursive: true });
  const failed: { path: string; error: string }[] = [];
  let installed = 0;

  const CONCURRENCY = 6;
  let cursor = 0;
  async function worker() {
    while (cursor < mods.length) {
      const mod = mods[cursor++];
      try {
        if (!mod.url.startsWith('https://')) throw new Error('Only HTTPS URLs are allowed');
        const target = safePath(root, mod.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const response = await axios.get<NodeJS.ReadableStream>(mod.url, {
          responseType: 'stream',
          timeout: 60000,
          maxContentLength: 500 * 1024 * 1024,
          headers: { 'User-Agent': 'Kretase-Wings/1.0 (+https://kretase.com)' },
        });
        await new Promise<void>((resolve, reject) => {
          const writer = fs.createWriteStream(target);
          (response.data as NodeJS.ReadableStream).pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
          response.data.on('error', reject);
        });
        installed++;
      } catch (err) {
        failed.push({ path: mod.path, error: (err as Error).message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, mods.length) }, worker));

  logger.info(`Modpack mods installed for ${uuid}: ${installed} ok, ${failed.length} failed`);
  return res.json({ installed, failed });
});

export default router;
