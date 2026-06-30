"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const emailService_1 = require("../services/emailService");
const router = (0, express_1.Router)();
// POST /api/v1/installer/test-smtp — admin only: send test email to owner
router.post('/test-smtp', auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    const ownerEmail = process.env.REGISTRY_SMTP_OWNER
        || await prisma_1.prisma.setting.findUnique({ where: { key: 'smtp.owner_email' } }).then(r => r?.value || '');
    if (!ownerEmail) {
        return res.status(400).json({ message: 'No owner email configured. Set REGISTRY_SMTP_OWNER in .env or smtp.owner_email in Settings.' });
    }
    const ok = await (0, emailService_1.sendUpdateNotification)(ownerEmail, 'TEST — SMTP is working!').catch(() => false);
    if (!ok)
        return res.status(500).json({ message: 'SMTP send failed — check host/port/credentials.' });
    return res.json({ message: `Test email sent to ${ownerEmail}.` });
});
exports.default = router;
//# sourceMappingURL=installer.js.map