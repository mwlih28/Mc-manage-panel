"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../utils/prisma");
const jwt_1 = require("../utils/jwt");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
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
    });
    const tokens = (0, jwt_1.generateTokenPair)({
        userId: user.id,
        email: user.email,
        role: user.role,
    });
    const { password: _pw, ...userWithoutPassword } = user;
    return res.json({ user: userWithoutPassword, ...tokens });
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
    const { password: _pw, ...userWithoutPassword } = user;
    return res.status(201).json({ user: userWithoutPassword, ...tokens });
});
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(401).json({ message: 'Refresh token required' });
    }
    try {
        const payload = (0, jwt_1.verifyRefreshToken)(refreshToken);
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
    const { password: _pw, ...user } = req.user;
    return res.json({ user });
});
router.post('/logout', auth_1.authenticate, async (req, res) => {
    await prisma_1.prisma.activity.create({
        data: {
            userId: req.user.id,
            event: 'auth:logout',
            ip: req.ip,
        },
    });
    return res.json({ message: 'Logged out successfully' });
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
    const { password: _pw, ...userWithoutPassword } = user;
    return res.status(201).json({ user: userWithoutPassword, ...tokens });
});
exports.default = router;
//# sourceMappingURL=auth.js.map