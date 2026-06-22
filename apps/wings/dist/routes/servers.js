"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const axios_1 = __importDefault(require("axios"));
const serverManager_1 = require("../services/serverManager");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
const mcPing_1 = require("../services/mcPing");
const router = (0, express_1.Router)();
// Load/register a server
router.post('/', async (req, res) => {
    const config = req.body;
    try {
        await serverManager_1.serverManager.loadServer(config);
        return res.status(201).json({ message: 'Server loaded' });
    }
    catch (err) {
        logger_1.logger.error('Failed to load server:', err);
        return res.status(500).json({ message: err.message });
    }
});
// Power action
router.post('/:uuid/power', async (req, res) => {
    const { uuid } = req.params;
    const { action } = req.body;
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
        return res.status(422).json({ message: 'Invalid action' });
    }
    try {
        switch (action) {
            case 'start':
                serverManager_1.serverManager.startServer(uuid).catch(err => logger_1.logger.error(`Start failed: ${err.message}`));
                break;
            case 'stop':
                serverManager_1.serverManager.stopServer(uuid).catch(err => logger_1.logger.error(`Stop failed: ${err.message}`));
                break;
            case 'restart':
                serverManager_1.serverManager.restartServer(uuid).catch(err => logger_1.logger.error(`Restart failed: ${err.message}`));
                break;
            case 'kill':
                serverManager_1.serverManager.killServer(uuid).catch(err => logger_1.logger.error(`Kill failed: ${err.message}`));
                break;
        }
        return res.json({ message: `${action} initiated` });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// Send command
router.post('/:uuid/command', async (req, res) => {
    const { uuid } = req.params;
    const { command } = req.body;
    if (!command)
        return res.status(422).json({ message: 'Command required' });
    await serverManager_1.serverManager.sendCommand(uuid, command);
    return res.json({ message: 'Command sent' });
});
// Get resources/stats
router.get('/:uuid/resources', async (req, res) => {
    const { uuid } = req.params;
    const resources = await serverManager_1.serverManager.getResources(uuid);
    return res.json({ resources });
});
// Get status
router.get('/:uuid/status', (req, res) => {
    const status = serverManager_1.serverManager.getStatus(req.params.uuid);
    return res.json({ status });
});
// Delete server
router.delete('/:uuid', async (req, res) => {
    try {
        await serverManager_1.serverManager.deleteServer(req.params.uuid);
        return res.status(204).send();
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
// Get online players via Minecraft Server List Ping
router.get('/:uuid/players', async (req, res) => {
    const { uuid } = req.params;
    const env = serverManager_1.serverManager.getServerEnvironment(uuid);
    const port = parseInt(env['SERVER_PORT'] || env['PORT'] || '25565', 10);
    try {
        const result = await (0, mcPing_1.pingServer)('127.0.0.1', port, 4000);
        return res.json(result);
    }
    catch {
        return res.json({ online: 0, max: 0, players: [] });
    }
});
// Install a plugin/mod by downloading from a URL
router.post('/:uuid/plugins/install', async (req, res) => {
    const { uuid } = req.params;
    const { url, filename, type } = req.body;
    if (!url || !filename || !['plugins', 'mods'].includes(type)) {
        return res.status(422).json({ message: 'url, filename, and type (plugins|mods) required' });
    }
    if (!url.startsWith('https://')) {
        return res.status(422).json({ message: 'Only HTTPS URLs are allowed' });
    }
    const safeFilename = path_1.default.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeFilename.endsWith('.jar')) {
        return res.status(422).json({ message: 'Only .jar files are supported' });
    }
    const cfg = (0, config_1.getConfig)();
    const targetDir = path_1.default.resolve(path_1.default.join(cfg.system.data, uuid, type));
    const expectedBase = path_1.default.resolve(path_1.default.join(cfg.system.data, uuid));
    if (!targetDir.startsWith(expectedBase)) {
        return res.status(403).json({ message: 'Forbidden path' });
    }
    fs_1.default.mkdirSync(targetDir, { recursive: true });
    const targetPath = path_1.default.join(targetDir, safeFilename);
    try {
        const response = await axios_1.default.get(url, {
            responseType: 'stream',
            timeout: 60000,
            maxContentLength: 100 * 1024 * 1024, // 100 MB
        });
        await new Promise((resolve, reject) => {
            const writer = fs_1.default.createWriteStream(targetPath);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        logger_1.logger.info(`Plugin installed: ${safeFilename} → ${targetPath}`);
        return res.json({ message: `${safeFilename} installed successfully` });
    }
    catch (err) {
        if (fs_1.default.existsSync(targetPath))
            fs_1.default.unlinkSync(targetPath);
        return res.status(500).json({ message: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=servers.js.map