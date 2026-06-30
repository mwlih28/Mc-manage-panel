"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const DEFAULTS = {
    'app.name': 'Kretase',
    'app.title': 'Kretase',
    'app.logo': '',
    'app.description': 'High-performance game server management',
    'features.aiTools': 'true',
    'ai.provider': 'openai',
};
const PROVIDER_KEY_SETTING = {
    openai: 'ai.openaiKey',
    gemini: 'ai.geminiKey',
    anthropic: 'ai.anthropicKey',
};
// Keys safe to expose without authentication (sidebar/login branding, public
// feature flags). Everything else (SMTP creds, AI provider keys) is stripped
// out below unless the request comes from a logged-in admin.
const PUBLIC_KEYS = new Set(['app.name', 'app.title', 'app.logo', 'app.description', 'features.aiTools', 'ai.provider', 'ai.configured']);
router.get('/', auth_1.optionalAuth, async (req, res) => {
    try {
        const rows = await prisma_1.prisma.setting.findMany();
        const settings = { ...DEFAULTS };
        for (const r of rows)
            settings[r.key] = r.value;
        const providerKey = PROVIDER_KEY_SETTING[settings['ai.provider']] || 'ai.openaiKey';
        settings['ai.configured'] = settings[providerKey] ? 'true' : 'false';
        if (req.user?.role !== 'ADMIN') {
            for (const key of Object.keys(settings)) {
                if (!PUBLIC_KEYS.has(key))
                    delete settings[key];
            }
        }
        return res.json(settings);
    }
    catch {
        return res.json(DEFAULTS);
    }
});
router.put('/', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    if (req.body['ai.provider'] !== undefined && !PROVIDER_KEY_SETTING[req.body['ai.provider']]) {
        return res.status(422).json({ message: 'Invalid ai.provider — must be openai, gemini, or anthropic' });
    }
    const allowed = [
        'app.name', 'app.title', 'app.logo', 'app.description',
        'smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.from', 'smtp.owner_email',
        'features.aiTools', 'ai.provider', 'ai.openaiKey', 'ai.geminiKey', 'ai.anthropicKey',
    ];
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