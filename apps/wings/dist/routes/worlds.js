"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const fileManager_1 = require("../services/fileManager");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)({ mergeParams: true });
// GET /api/servers/:uuid/worlds
router.get('/', async (req, res) => {
    const { uuid } = req.params;
    try {
        const worlds = await (0, fileManager_1.listWorlds)(uuid);
        return res.json({ worlds, active: (0, fileManager_1.getActiveWorldName)(uuid) });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// PUT /api/servers/:uuid/worlds/active — switch which world server.properties points at
router.put('/active', async (req, res) => {
    const { uuid } = req.params;
    const { name } = req.body;
    if (!name)
        return res.status(422).json({ message: 'World name required' });
    try {
        const worlds = await (0, fileManager_1.listWorlds)(uuid);
        if (!worlds.some(w => w.name === name)) {
            return res.status(404).json({ message: `World "${name}" not found` });
        }
        await (0, fileManager_1.setActiveWorldName)(uuid, name);
        return res.json({ message: `Active world set to "${name}"` });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// POST /api/servers/:uuid/worlds/install — download a world zip from a URL and install it
router.post('/install', async (req, res) => {
    const { uuid } = req.params;
    const { url, name } = req.body;
    if (!url || !name)
        return res.status(422).json({ message: 'url and name required' });
    if (!url.startsWith('https://'))
        return res.status(422).json({ message: 'Only HTTPS URLs are allowed' });
    const tmpDir = path_1.default.join(os_1.default.tmpdir(), `mc_world_dl_${Date.now()}_${uuid}`);
    const tmpFile = path_1.default.join(tmpDir, 'world.zip');
    try {
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
        const response = await axios_1.default.get(url, {
            responseType: 'stream',
            timeout: 120000,
            maxContentLength: 500 * 1024 * 1024,
        });
        await new Promise((resolve, reject) => {
            const writer = fs_1.default.createWriteStream(tmpFile);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        await (0, fileManager_1.installWorldFromZipFile)(uuid, tmpFile, name);
        logger_1.logger.info(`World "${name}" installed for ${uuid} from URL`);
        return res.json({ message: `World "${name}" installed` });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
    finally {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    }
});
// POST /api/servers/:uuid/worlds/upload — upload a world zip directly
const upload = (0, multer_1.default)({ dest: path_1.default.join(os_1.default.tmpdir(), 'mc-wings-world-uploads') });
router.post('/upload', upload.single('file'), async (req, res) => {
    const { uuid } = req.params;
    const { name } = req.body;
    const file = req.file;
    if (!file)
        return res.status(422).json({ message: 'No file uploaded' });
    if (!name) {
        fs_1.default.unlink(file.path, () => { });
        return res.status(422).json({ message: 'World name required' });
    }
    try {
        await (0, fileManager_1.installWorldFromZipFile)(uuid, file.path, name);
        logger_1.logger.info(`World "${name}" installed for ${uuid} from upload`);
        return res.json({ message: `World "${name}" installed` });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
    finally {
        fs_1.default.unlink(file.path, () => { });
    }
});
// GET /api/servers/:uuid/worlds/:name/download — stream a world as a zip
router.get('/:name/download', (req, res) => {
    const { uuid, name } = req.params;
    try {
        const archive = (0, fileManager_1.createWorldZipStream)(uuid, name);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
        archive.pipe(res);
        archive.on('error', (err) => {
            logger_1.logger.error(`World zip stream error for ${uuid}/${name}: ${err.message}`);
            res.destroy();
        });
    }
    catch (err) {
        return res.status(400).json({ message: err.message });
    }
});
// DELETE /api/servers/:uuid/worlds/:name — delete a world folder (cannot delete active world)
router.delete('/:name', async (req, res) => {
    const { uuid, name } = req.params;
    try {
        if ((0, fileManager_1.getActiveWorldName)(uuid) === name) {
            return res.status(400).json({ message: 'Cannot delete the active world. Switch to another world first.' });
        }
        const worlds = await (0, fileManager_1.listWorlds)(uuid);
        if (!worlds.some(w => w.name === name)) {
            return res.status(404).json({ message: `World "${name}" not found` });
        }
        await (0, fileManager_1.deleteFiles)(uuid, [name]);
        return res.json({ message: `World "${name}" deleted` });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=worlds.js.map