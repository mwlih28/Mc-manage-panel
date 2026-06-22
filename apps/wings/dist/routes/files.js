"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
const fileManager_1 = require("../services/fileManager");
const router = (0, express_1.Router)({ mergeParams: true });
// GET /api/servers/:uuid/files?directory=/
router.get('/', async (req, res) => {
    const { uuid } = req.params;
    const dir = req.query.directory || '/';
    try {
        const files = await (0, fileManager_1.listDirectory)(uuid, dir);
        return res.json({ files });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// GET /api/servers/:uuid/files/contents?file=server.properties
router.get('/contents', async (req, res) => {
    const { uuid } = req.params;
    const filePath = req.query.file || '';
    if (!filePath)
        return res.status(422).json({ message: 'File path required' });
    try {
        const content = await (0, fileManager_1.readFile)(uuid, filePath);
        return res.json({ content });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// POST /api/servers/:uuid/files/write
router.post('/write', async (req, res) => {
    const { uuid } = req.params;
    const { file, content } = req.body;
    if (!file)
        return res.status(422).json({ message: 'File path required' });
    try {
        await (0, fileManager_1.writeFile)(uuid, file, content || '');
        return res.json({ message: 'File saved' });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// POST /api/servers/:uuid/files/delete
router.post('/delete', async (req, res) => {
    const { uuid } = req.params;
    const { files } = req.body;
    if (!Array.isArray(files))
        return res.status(422).json({ message: 'Files array required' });
    try {
        await (0, fileManager_1.deleteFiles)(uuid, files);
        return res.json({ message: 'Files deleted' });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// POST /api/servers/:uuid/files/create-folder
router.post('/create-folder', async (req, res) => {
    const { uuid } = req.params;
    const { name, directory = '/' } = req.body;
    try {
        await (0, fileManager_1.createDirectory)(uuid, path_1.default.join(directory, name));
        return res.json({ message: 'Directory created' });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// PUT /api/servers/:uuid/files/rename
router.put('/rename', async (req, res) => {
    const { uuid } = req.params;
    const { from, to } = req.body;
    try {
        await (0, fileManager_1.renameFile)(uuid, from, to);
        return res.json({ message: 'File renamed' });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// File upload
const upload = (0, multer_1.default)({ dest: '/tmp/mc-wings-uploads/' });
router.post('/upload', upload.array('files'), async (req, res) => {
    const { uuid } = req.params;
    const dir = req.query.directory || '/';
    const cfg = (0, config_1.getConfig)();
    const root = path_1.default.join(cfg.system.data, uuid);
    const files = req.files;
    if (!files || files.length === 0)
        return res.status(422).json({ message: 'No files uploaded' });
    for (const file of files) {
        const destDir = path_1.default.join(root, dir);
        const destPath = path_1.default.join(destDir, file.originalname);
        fs_1.default.mkdirSync(destDir, { recursive: true });
        fs_1.default.renameSync(file.path, destPath);
    }
    return res.json({ message: `${files.length} file(s) uploaded` });
});
// Download file
router.get('/download', async (req, res) => {
    const { uuid } = req.params;
    const filePath = req.query.file || '';
    if (!filePath)
        return res.status(422).json({ message: 'File path required' });
    const cfg = (0, config_1.getConfig)();
    const root = path_1.default.join(cfg.system.data, uuid);
    const target = path_1.default.resolve(root, filePath.replace(/^\/+/, ''));
    if (!target.startsWith(root))
        return res.status(403).json({ message: 'Forbidden' });
    if (!fs_1.default.existsSync(target))
        return res.status(404).json({ message: 'File not found' });
    return res.download(target);
});
exports.default = router;
//# sourceMappingURL=files.js.map