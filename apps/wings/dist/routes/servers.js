"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const serverManager_1 = require("../services/serverManager");
const logger_1 = require("../utils/logger");
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
exports.default = router;
//# sourceMappingURL=servers.js.map