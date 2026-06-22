"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const systeminformation_1 = __importDefault(require("systeminformation"));
const config_1 = require("../config");
const serverManager_1 = require("../services/serverManager");
const router = (0, express_1.Router)();
// Heartbeat / health
router.get('/health', async (_req, res) => {
    const cfg = (0, config_1.getConfig)();
    return res.json({
        status: 'ok',
        version: '1.0.0',
        uuid: cfg.uuid,
        timestamp: new Date().toISOString(),
    });
});
// System info
router.get('/system', async (_req, res) => {
    const [cpu, mem, disk, os] = await Promise.all([
        systeminformation_1.default.currentLoad(),
        systeminformation_1.default.mem(),
        systeminformation_1.default.fsSize(),
        systeminformation_1.default.osInfo(),
    ]);
    return res.json({
        cpu: {
            model: (await systeminformation_1.default.cpu()).brand,
            cores: (await systeminformation_1.default.cpu()).cores,
            usage: parseFloat(cpu.currentLoad.toFixed(2)),
        },
        memory: {
            total: mem.total,
            used: mem.active,
            free: mem.free,
        },
        disk: disk.map(d => ({
            fs: d.fs,
            size: d.size,
            used: d.used,
            available: d.available,
            mount: d.mount,
        })),
        os: {
            platform: os.platform,
            distro: os.distro,
            release: os.release,
            hostname: os.hostname,
        },
    });
});
// List servers managed by this daemon
router.get('/servers', (_req, res) => {
    const servers = serverManager_1.serverManager.getServerList();
    return res.json({ servers });
});
exports.default = router;
//# sourceMappingURL=system.js.map