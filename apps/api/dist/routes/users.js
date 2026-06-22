"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
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
exports.default = router;
//# sourceMappingURL=users.js.map