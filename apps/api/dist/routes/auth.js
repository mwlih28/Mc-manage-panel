"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../utils/prisma");
const jwt_1 = require("../utils/jwt");
const auth_1 = require("../middleware/auth");
const otplib_1 = require("otplib");
const emailService_1 = require("../services/emailService");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET;
function safeUser(user) {
    const { password, twoFactorSecret, smtpPass, ...rest } = user;
    void password;
    void twoFactorSecret;
    void smtpPass;
    return rest;
}
router.post('/login', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('password').notEmpty(),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    const { email, password } = req.body;
    const user = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }
    const valid = await bcryptjs_1.default.compare(password, user.password);
    if (!valid) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }
    await prisma_1.prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
    });
    await prisma_1.prisma.activity.create({
        data: {
            userId: user.id,
            event: 'auth:login',
            ip: req.ip,
        },
    }).catch(() => { });
    // 2FA check
    if (user.twoFactor && user.twoFactorSecret) {
        const pendingToken = jsonwebtoken_1.default.sign({ userId: user.id, pending: true }, JWT_SECRET, { expiresIn: '5m' });
        return res.json({ requiresTwoFactor: true, pendingToken });
    }
    const tokens = (0, jwt_1.generateTokenPair)({
        userId: user.id,
        email: user.email,
        role: user.role,
    });
    return res.json({ ...tokens, user: safeUser(user) });
});
router.post('/2fa/verify', async (req, res) => {
    const { pendingToken, code } = req.body;
    if (!pendingToken || !code)
        return res.status(422).json({ message: 'pendingToken and code required' });
    try {
        const payload = jsonwebtoken_1.default.verify(pendingToken, JWT_SECRET);
        if (!payload.pending)
            return res.status(401).json({ message: 'Invalid token' });
        const user = await prisma_1.prisma.user.findUnique({ where: { id: payload.userId } });
        if (!user || !user.twoFactor || !user.twoFactorSecret)
            return res.status(401).json({ message: 'Invalid state' });
        const result = await (0, otplib_1.verify)({ secret: user.twoFactorSecret, token: code });
        const valid = result.valid;
        if (!valid)
            return res.status(401).json({ message: 'Invalid 2FA code' });
        const tokens = (0, jwt_1.generateTokenPair)({
            userId: user.id,
            email: user.email,
            role: user.role,
        });
        return res.json({ ...tokens, user: safeUser(user) });
    }
    catch {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
});
router.post('/register', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('username').isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
    (0, express_validator_1.body)('password').isLength({ min: 8 }),
    (0, express_validator_1.body)('firstName').notEmpty().trim(),
    (0, express_validator_1.body)('lastName').notEmpty().trim(),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    const { email, username, password, firstName, lastName } = req.body;
    const existing = await prisma_1.prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
    });
    if (existing) {
        return res.status(409).json({ message: 'Email or username already taken' });
    }
    const hashedPassword = await bcryptjs_1.default.hash(password, 12);
    const user = await prisma_1.prisma.user.create({
        data: {
            email,
            username,
            password: hashedPassword,
            firstName,
            lastName,
        },
    });
    const tokens = (0, jwt_1.generateTokenPair)({
        userId: user.id,
        email: user.email,
        role: user.role,
    });
    return res.status(201).json({ ...tokens, user: safeUser(user) });
});
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(401).json({ message: 'Refresh token required' });
    }
    try {
        const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret';
        const payload = jsonwebtoken_1.default.verify(refreshToken, JWT_REFRESH_SECRET);
        const user = await prisma_1.prisma.user.findUnique({ where: { id: payload.userId } });
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }
        const tokens = (0, jwt_1.generateTokenPair)({
            userId: user.id,
            email: user.email,
            role: user.role,
        });
        return res.json(tokens);
    }
    catch {
        return res.status(401).json({ message: 'Invalid refresh token' });
    }
});
router.get('/me', auth_1.authenticate, async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    return res.json({ user: safeUser(user) });
});
router.post('/logout', auth_1.authenticate, async (req, res) => {
    await prisma_1.prisma.activity.create({
        data: {
            userId: req.user.id,
            event: 'auth:logout',
            ip: req.ip,
        },
    }).catch(() => { });
    return res.json({ message: 'Logged out successfully' });
});
// POST /auth/forgot-password — emails a reset link via the panel owner's own SMTP
router.post('/forgot-password', [(0, express_validator_1.body)('email').isEmail().normalizeEmail()], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty())
        return res.status(422).json({ errors: errors.array() });
    const { email } = req.body;
    // Always return the same generic response, whether or not the email exists,
    // so this endpoint can't be used to enumerate registered accounts.
    const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };
    const user = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (!user)
        return res.json(genericResponse);
    const resetToken = crypto_1.default.randomBytes(32).toString('hex');
    await prisma_1.prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const appNameRow = await prisma_1.prisma.setting.findUnique({ where: { key: 'app.name' } });
    const frontendOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
    const resetUrl = `${frontendOrigin}/reset-password?token=${resetToken}`;
    (0, emailService_1.sendPasswordResetEmail)(user.email, resetUrl, appNameRow?.value || 'Kretase').catch(() => { });
    return res.json(genericResponse);
});
// POST /auth/reset-password
router.post('/reset-password', [(0, express_validator_1.body)('token').notEmpty(), (0, express_validator_1.body)('password').isLength({ min: 8 })], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty())
        return res.status(422).json({ errors: errors.array() });
    const { token, password } = req.body;
    const user = await prisma_1.prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
        return res.status(400).json({ message: 'Reset link is invalid or has expired' });
    }
    const hashedPassword = await bcryptjs_1.default.hash(password, 12);
    await prisma_1.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword, resetToken: null, resetTokenExpiry: null },
    });
    await prisma_1.prisma.activity.create({
        data: { userId: user.id, event: 'auth:password_reset', ip: req.ip },
    }).catch(() => { });
    return res.json({ message: 'Password updated — you can now log in' });
});
// GET /auth/setup/status - check if initial setup is needed
router.get('/setup/status', async (_req, res) => {
    const count = await prisma_1.prisma.user.count();
    return res.json({ needsSetup: count === 0 });
});
// POST /auth/setup - create first admin user (only works if no users exist)
router.post('/setup', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('username').isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
    (0, express_validator_1.body)('password').isLength({ min: 8 }),
    (0, express_validator_1.body)('firstName').notEmpty().trim(),
    (0, express_validator_1.body)('lastName').notEmpty().trim(),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    const count = await prisma_1.prisma.user.count();
    if (count > 0) {
        return res.status(403).json({ message: 'Setup already completed' });
    }
    const { email, username, password, firstName, lastName } = req.body;
    const hashedPassword = await bcryptjs_1.default.hash(password, 12);
    const user = await prisma_1.prisma.user.create({
        data: {
            email,
            username,
            password: hashedPassword,
            firstName,
            lastName,
            role: 'ADMIN',
            rootAdmin: true,
        },
    });
    const tokens = (0, jwt_1.generateTokenPair)({
        userId: user.id,
        email: user.email,
        role: user.role,
    });
    return res.status(201).json({ ...tokens, user: safeUser(user) });
});
exports.default = router;
//# sourceMappingURL=auth.js.map