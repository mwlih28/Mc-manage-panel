"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const prisma_1 = require("../utils/prisma");
const aiService_1 = require("../services/aiService");
const router = (0, express_1.Router)();
// Each AI call costs the panel owner real money (their own OpenAI key) — keep
// a simple per-user cooldown so one impatient click-spammer can't run up a bill.
const COOLDOWN_MS = 15000;
const lastRequestAt = new Map();
function checkCooldown(userId) {
    const last = lastRequestAt.get(userId) || 0;
    if (Date.now() - last < COOLDOWN_MS)
        return false;
    lastRequestAt.set(userId, Date.now());
    return true;
}
async function aiToolsEnabled() {
    const row = await prisma_1.prisma.setting.findUnique({ where: { key: 'features.aiTools' } });
    return row ? row.value === 'true' : true;
}
router.post('/motd', auth_1.authenticate, async (req, res) => {
    if (!(await aiToolsEnabled()))
        return res.status(403).json({ message: 'AI Tools disabled by administrator' });
    if (!checkCooldown(req.user.id))
        return res.status(429).json({ message: 'Please wait a few seconds before generating again' });
    const { serverName = '', theme = 'random' } = req.body;
    try {
        const results = await (0, aiService_1.generateMotdWithAi)(serverName, theme);
        return res.json({ results });
    }
    catch (err) {
        return res.status(502).json({ message: err.message || 'AI generation failed' });
    }
});
router.post('/logo', auth_1.authenticate, async (req, res) => {
    if (!(await aiToolsEnabled()))
        return res.status(403).json({ message: 'AI Tools disabled by administrator' });
    if (!checkCooldown(req.user.id))
        return res.status(429).json({ message: 'Please wait a few seconds before generating again' });
    const { serverName = '' } = req.body;
    try {
        const images = await (0, aiService_1.generateLogoWithAi)(serverName);
        return res.json({ images });
    }
    catch (err) {
        return res.status(502).json({ message: err.message || 'AI generation failed' });
    }
});
exports.default = router;
//# sourceMappingURL=ai.js.map