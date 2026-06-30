"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const emailService_1 = require("../services/emailService");
const router = (0, express_1.Router)();
// Simple in-memory rate limit: 1 registration per IP per hour
const recentIps = new Map();
setInterval(() => {
    const cutoff = Date.now() - 3600000;
    for (const [ip, ts] of recentIps) {
        if (ts < cutoff)
            recentIps.delete(ip);
    }
}, 600000);
// POST /api/v1/installer/register — called by install script, no auth
router.post('/register', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('serverIp').notEmpty().isString(),
    (0, express_validator_1.body)('name').optional().isString().trim(),
    (0, express_validator_1.body)('panelDomain').optional().isString(),
    (0, express_validator_1.body)('panelVersion').optional().isString(),
    (0, express_validator_1.body)('notifyUpdates').optional().isBoolean(),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty())
        return res.status(422).json({ errors: errors.array() });
    const ip = (req.ip || '127.0.0.1').replace('::ffff:', '');
    const now = Date.now();
    if (recentIps.has(ip) && (now - recentIps.get(ip)) < 3600000) {
        return res.status(429).json({ message: 'Rate limit: one registration per hour per IP.' });
    }
    recentIps.set(ip, now);
    const { email, name = '', serverIp, panelDomain = '', panelVersion = '', notifyUpdates = false } = req.body;
    const existing = await prisma_1.prisma.installerRegistration.findFirst({ where: { serverIp } });
    if (existing) {
        await prisma_1.prisma.installerRegistration.update({
            where: { id: existing.id },
            data: { email, name, panelDomain, panelVersion, notifyUpdates },
        });
        return res.json({ message: 'Registration updated.' });
    }
    await prisma_1.prisma.installerRegistration.create({
        data: { email, name, serverIp, panelDomain, panelVersion, notifyUpdates },
    });
    // Fire-and-forget: thank-you email to installer + owner notification
    (0, emailService_1.sendThankYouEmail)(email, name, serverIp).catch(() => { });
    (0, emailService_1.sendOwnerNotification)(name, email, serverIp, panelDomain).catch(() => { });
    return res.status(201).json({ message: 'Registered. Thank-you email queued.' });
});
// GET /api/v1/installer/registrations — admin only
router.get('/registrations', auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    const list = await prisma_1.prisma.installerRegistration.findMany({ orderBy: { installedAt: 'desc' } });
    return res.json(list);
});
// GET /api/v1/installer/registrations/stats — admin only
router.get('/registrations/stats', auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    const total = await prisma_1.prisma.installerRegistration.count();
    const withNotify = await prisma_1.prisma.installerRegistration.count({ where: { notifyUpdates: true } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await prisma_1.prisma.installerRegistration.count({ where: { installedAt: { gte: today } } });
    return res.json({ total, withNotify, today: todayCount });
});
// POST /api/v1/installer/notify-updates
// Accepts either:
//   - JWT admin auth (from the Admin UI)
//   - X-Notify-Secret header matching NOTIFY_WEBHOOK_SECRET env var (for GitHub Actions / CI)
async function notifyUpdatesHandler(req, res) {
    const { version = 'latest', changelogUrl } = req.body;
    if (!version || version === 'latest') {
        return res.status(400).json({ message: 'Provide a version string, e.g. "v1.2.0"' });
    }
    const registrations = await prisma_1.prisma.installerRegistration.findMany({ where: { notifyUpdates: true } });
    if (registrations.length === 0) {
        return res.json({ sent: 0, failed: 0, total: 0, message: 'No opted-in subscribers.' });
    }
    let sent = 0;
    let failed = 0;
    for (const reg of registrations) {
        const ok = await (0, emailService_1.sendUpdateNotification)(reg.email, version, changelogUrl);
        if (ok)
            sent++;
        else
            failed++;
    }
    return res.json({ sent, failed, total: registrations.length });
}
function webhookSecretAuth(req, res, next) {
    const secret = process.env.NOTIFY_WEBHOOK_SECRET;
    if (secret && req.headers['x-notify-secret'] === secret)
        return next();
    return res.status(401).json({ message: 'Unauthorized' });
}
router.post('/notify-updates', (req, res, next) => {
    const secret = process.env.NOTIFY_WEBHOOK_SECRET;
    // Allow webhook secret auth as alternative to JWT
    if (secret && req.headers['x-notify-secret'] === secret)
        return next();
    // Otherwise require JWT admin
    return (0, auth_1.authenticate)(req, res, (err) => {
        if (err)
            return next(err);
        return (0, auth_1.requireAdmin)(req, res, next);
    });
}, notifyUpdatesHandler);
void webhookSecretAuth;
// POST /api/v1/installer/test-smtp — admin only: send test email to owner
router.post('/test-smtp', auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    // Resolve owner email: registry env var takes priority, then DB setting
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
// GET /api/v1/installer/subscribers — returns opted-in emails for n8n / Make.com / Zapier
// Auth: JWT admin OR X-Notify-Secret header (so external tools can call it)
router.get('/subscribers', (req, res, next) => {
    const secret = process.env.NOTIFY_WEBHOOK_SECRET;
    if (secret && req.headers['x-notify-secret'] === secret)
        return next();
    return (0, auth_1.authenticate)(req, res, (err) => {
        if (err)
            return next(err);
        return (0, auth_1.requireAdmin)(req, res, next);
    });
}, async (_req, res) => {
    const rows = await prisma_1.prisma.installerRegistration.findMany({
        where: { notifyUpdates: true },
        select: { email: true, name: true, serverIp: true, panelDomain: true, installedAt: true },
        orderBy: { installedAt: 'desc' },
    });
    return res.json({ count: rows.length, subscribers: rows });
});
// DELETE /api/v1/installer/registrations/:id — admin only
router.delete('/registrations/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    await prisma_1.prisma.installerRegistration.delete({ where: { id: req.params.id } });
    return res.json({ message: 'Deleted.' });
});
exports.default = router;
//# sourceMappingURL=installer.js.map