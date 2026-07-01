"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const curseforgeApi_1 = require("../services/curseforgeApi");
const router = (0, express_1.Router)();
router.get('/status', auth_1.authenticate, async (_req, res) => {
    return res.json({ configured: await (0, curseforgeApi_1.isCurseForgeConfigured)() });
});
// GET /curseforge/worlds/search?query=&index=&pageSize=
router.get('/worlds/search', auth_1.authenticate, async (req, res) => {
    try {
        const query = req.query.query || '';
        const index = parseInt(req.query.index) || 0;
        const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 50);
        const result = await (0, curseforgeApi_1.searchWorlds)(query, index, pageSize);
        return res.json(result);
    }
    catch (err) {
        return res.status(502).json({ message: err.message || 'CurseForge search failed' });
    }
});
// GET /curseforge/worlds/:modId/files
router.get('/worlds/:modId/files', auth_1.authenticate, async (req, res) => {
    try {
        const modId = parseInt(req.params.modId);
        const files = await (0, curseforgeApi_1.getWorldFiles)(modId);
        return res.json({ files });
    }
    catch (err) {
        return res.status(502).json({ message: err.message || 'Failed to fetch world files' });
    }
});
exports.default = router;
//# sourceMappingURL=curseforge.js.map