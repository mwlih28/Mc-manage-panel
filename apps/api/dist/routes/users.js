"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const otplib_1 = require("otplib");
const qrcode_1 = __importDefault(require("qrcode"));
const router = (0, express_1.Router)();
// GET /users - Admin only
router.get('/', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 20;
    const search = req.query.search;
    const where = search
        ? {
            OR: [
                { email: { contains: search } },
                { username: { contains: search } },
                { firstName: { contains: search } },
                { lastName: { contains: search } },
            ],
        }
        : {};
    const [users, total] = await Promise.all([
        prisma_1.prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                username: true,
                firstName: true,
                lastName: true,
                role: true,
                rootAdmin: true,
                createdAt: true,
                lastLogin: true,
                _count: { select: { servers: true } },
            },
            skip: (page - 1) * perPage,
            take: perPage,
            orderBy: { createdAt: 'desc' },
        }),
        prisma_1.prisma.user.count({ where }),
    ]);
    return res.json({
        data: users,
        meta: { total, page, perPage, lastPage: Math.ceil(total / perPage) },
    });
});
// GET /users/:id
router.get('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: req.params.id },
        select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            role: true,
            rootAdmin: true,
            language: true,
            twoFactor: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
            lastLogin: true,
            _count: { select: { servers: true } },
        },
    });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    return res.json({ data: user });
});
// POST /users - Admin create user
router.post('/', auth_1.authenticate, auth_1.requireAdmin, [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('username').isLength({ min: 3, max: 20 }),
    (0, express_validator_1.body)('password').isLength({ min: 8 }),
    (0, express_validator_1.body)('firstName').notEmpty().trim(),
    (0, express_validator_1.body)('lastName').notEmpty().trim(),
    (0, express_validator_1.body)('role').optional().isIn(['USER', 'ADMIN']),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty())
        return res.status(422).json({ errors: errors.array() });
    const { email, username, password, firstName, lastName, role } = req.body;
    const existing = await prisma_1.prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
    });
    if (existing)
        return res.status(409).json({ message: 'Email or username already taken' });
    const hashedPassword = await bcryptjs_1.default.hash(password, 12);
    const user = await prisma_1.prisma.user.create({
        data: { email, username, password: hashedPassword, firstName, lastName, role },
        select: {
            id: true, email: true, username: true, firstName: true, lastName: true,
            role: true, rootAdmin: true, createdAt: true,
        },
    });
    return res.status(201).json({ data: user });
});
// PATCH /users/:id
router.patch('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { firstName, lastName, email, role, rootAdmin, password } = req.body;
    const updateData = {};
    if (firstName)
        updateData.firstName = firstName;
    if (lastName)
        updateData.lastName = lastName;
    if (email)
        updateData.email = email;
    if (role)
        updateData.role = role;
    if (typeof rootAdmin === 'boolean')
        updateData.rootAdmin = rootAdmin;
    if (password)
        updateData.password = await bcryptjs_1.default.hash(password, 12);
    const user = await prisma_1.prisma.user.update({
        where: { id: req.params.id },
        data: updateData,
        select: {
            id: true, email: true, username: true, firstName: true, lastName: true,
            role: true, rootAdmin: true, updatedAt: true,
        },
    });
    return res.json({ data: user });
});
// DELETE /users/:id
router.delete('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    if (req.user.id === req.params.id) {
        return res.status(400).json({ message: 'Cannot delete your own account' });
    }
    await prisma_1.prisma.user.delete({ where: { id: req.params.id } });
    return res.status(204).send();
});
// GET /users/profile/me - Current user profile
router.get('/profile/me', auth_1.authenticate, async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
            id: true, email: true, username: true, firstName: true, lastName: true,
            role: true, language: true, twoFactor: true, avatarUrl: true,
            createdAt: true, lastLogin: true,
        },
    });
    return res.json({ data: user });
});
// PATCH /users/profile/me - Update own profile
router.patch('/profile/me', auth_1.authenticate, async (req, res) => {
    const { firstName, lastName, language, currentPassword, newPassword } = req.body;
    const updateData = {};
    if (firstName)
        updateData.firstName = firstName;
    if (lastName)
        updateData.lastName = lastName;
    if (language)
        updateData.language = language;
    if (newPassword) {
        const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
        const valid = await bcryptjs_1.default.compare(currentPassword || '', user.password);
        if (!valid)
            return res.status(400).json({ message: 'Current password is incorrect' });
        updateData.password = await bcryptjs_1.default.hash(newPassword, 12);
    }
    const updated = await prisma_1.prisma.user.update({
        where: { id: req.user.id },
        data: updateData,
        select: {
            id: true, email: true, username: true, firstName: true, lastName: true,
            role: true, language: true, updatedAt: true,
        },
    });
    return res.json({ data: updated });
});
// ── 2FA setup & management ────────────────────────────────────────────────────
router.post('/profile/2fa/setup', auth_1.authenticate, async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    if (user.twoFactor)
        return res.status(400).json({ message: '2FA is already enabled' });
    const secret = (0, otplib_1.generateSecret)();
    const otpauthUrl = (0, otplib_1.generateURI)({ issuer: 'MC Manage Panel', label: user.email, secret });
    const qrCode = await qrcode_1.default.toDataURL(otpauthUrl);
    // Store secret temporarily (unconfirmed)
    await prisma_1.prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret } });
    return res.json({ secret, qrCode, otpauthUrl });
});
router.post('/profile/2fa/enable', auth_1.authenticate, async (req, res) => {
    const { code } = req.body;
    if (!code)
        return res.status(422).json({ message: 'Code required' });
    const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.twoFactorSecret)
        return res.status(400).json({ message: 'Run /setup first' });
    if (user.twoFactor)
        return res.status(400).json({ message: '2FA already enabled' });
    const result = await (0, otplib_1.verify)({ secret: user.twoFactorSecret, token: code });
    if (!result.valid)
        return res.status(401).json({ message: 'Invalid code' });
    await prisma_1.prisma.user.update({ where: { id: user.id }, data: { twoFactor: true } });
    return res.json({ message: '2FA enabled' });
});
router.delete('/profile/2fa', auth_1.authenticate, async (req, res) => {
    const { code } = req.body;
    const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.twoFactor || !user.twoFactorSecret)
        return res.status(400).json({ message: '2FA not enabled' });
    const result = await (0, otplib_1.verify)({ secret: user.twoFactorSecret, token: code });
    if (!result.valid)
        return res.status(401).json({ message: 'Invalid code' });
    await prisma_1.prisma.user.update({ where: { id: user.id }, data: { twoFactor: false, twoFactorSecret: null } });
    return res.json({ message: '2FA disabled' });
});
// ── SMTP config ───────────────────────────────────────────────────────────────
router.get('/profile/smtp', auth_1.authenticate, async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user)
        return res.status(404).json({ message: 'Not found' });
    return res.json({
        host: user.smtpHost ?? '',
        port: user.smtpPort ?? 587,
        user: user.smtpUser ?? '',
        from: user.smtpFrom ?? '',
        configured: !!user.smtpHost,
    });
});
router.put('/profile/smtp', auth_1.authenticate, async (req, res) => {
    const { host, port, user: smtpUser, pass, from } = req.body;
    const data = {};
    if (host !== undefined)
        data.smtpHost = host || null;
    if (port !== undefined)
        data.smtpPort = port ? Number(port) : null;
    if (smtpUser !== undefined)
        data.smtpUser = smtpUser || null;
    if (pass !== undefined && pass !== '')
        data.smtpPass = pass;
    if (from !== undefined)
        data.smtpFrom = from || null;
    await prisma_1.prisma.user.update({ where: { id: req.user.id }, data });
    return res.json({ message: 'SMTP settings saved' });
});
router.post('/profile/smtp/test', auth_1.authenticate, async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.smtpHost)
        return res.status(400).json({ message: 'SMTP not configured' });
    try {
        const nodemailer = await Promise.resolve().then(() => __importStar(require('nodemailer')));
        const transporter = nodemailer.createTransport({
            host: user.smtpHost,
            port: user.smtpPort ?? 587,
            secure: (user.smtpPort ?? 587) === 465,
            auth: user.smtpUser && user.smtpPass ? { user: user.smtpUser, pass: user.smtpPass } : undefined,
        });
        await transporter.sendMail({
            from: user.smtpFrom || user.smtpUser || 'noreply@example.com',
            to: user.email,
            subject: 'MC Manage Panel - SMTP Test',
            text: 'Your SMTP configuration is working correctly.',
        });
        return res.json({ message: `Test email sent to ${user.email}` });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map