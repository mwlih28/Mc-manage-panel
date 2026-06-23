"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const DEFAULTS = {
    'app.name': 'MC Manage Panel',
    'app.title': 'MC Manage Panel',
    'app.logo': '',
    'app.description': 'High-performance game server management',
};
router.get('/', async (_req, res) => {
    try {
        const rows = await prisma_1.prisma.setting.findMany();
        const settings = { ...DEFAULTS };
        for (const r of rows)
            settings[r.key] = r.value;
        return res.json(settings);
    }
    catch {
        return res.json(DEFAULTS);
    }
});
router.put('/', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const allowed = ['app.name', 'app.title', 'app.logo', 'app.description'];
    const updates = [];
    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            updates.push({ key, value: String(req.body[key]) });
        }
    }
    for (const u of updates) {
        await prisma_1.prisma.setting.upsert({
            where: { key: u.key },
            update: { value: u.value },
            create: { key: u.key, value: u.value },
        });
    }
    return res.json({ message: 'Settings saved' });
});
exports.default = router;
//# sourceMappingURL=settings.js.map