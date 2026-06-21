import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /users - Admin only
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const perPage = parseInt(req.query.perPage as string) || 20;
  const search = req.query.search as string;

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
    prisma.user.findMany({
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
    prisma.user.count({ where }),
  ]);

  return res.json({
    data: users,
    meta: { total, page, perPage, lastPage: Math.ceil(total / perPage) },
  });
});

// GET /users/:id
router.get('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
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

  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ data: user });
});

// POST /users - Admin create user
router.post(
  '/',
  authenticate,
  requireAdmin,
  [
    body('email').isEmail().normalizeEmail(),
    body('username').isLength({ min: 3, max: 20 }),
    body('password').isLength({ min: 8 }),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('role').optional().isIn(['USER', 'ADMIN']),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, username, password, firstName, lastName, role } = req.body;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) return res.status(409).json({ message: 'Email or username already taken' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, username, password: hashedPassword, firstName, lastName, role },
      select: {
        id: true, email: true, username: true, firstName: true, lastName: true,
        role: true, rootAdmin: true, createdAt: true,
      },
    });

    return res.status(201).json({ data: user });
  }
);

// PATCH /users/:id
router.patch(
  '/:id',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    const { firstName, lastName, email, role, rootAdmin, password } = req.body;

    const updateData: Record<string, unknown> = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (typeof rootAdmin === 'boolean') updateData.rootAdmin = rootAdmin;
    if (password) updateData.password = await bcrypt.hash(password, 12);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true, email: true, username: true, firstName: true, lastName: true,
        role: true, rootAdmin: true, updatedAt: true,
      },
    });

    return res.json({ data: user });
  }
);

// DELETE /users/:id
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  if (req.user!.id === req.params.id) {
    return res.status(400).json({ message: 'Cannot delete your own account' });
  }

  await prisma.user.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

// GET /users/profile/me - Current user profile
router.get('/profile/me', authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true, email: true, username: true, firstName: true, lastName: true,
      role: true, language: true, twoFactor: true, avatarUrl: true,
      createdAt: true, lastLogin: true,
    },
  });
  return res.json({ data: user });
});

// PATCH /users/profile/me - Update own profile
router.patch('/profile/me', authenticate, async (req: AuthRequest, res: Response) => {
  const { firstName, lastName, language, currentPassword, newPassword } = req.body;

  const updateData: Record<string, unknown> = {};
  if (firstName) updateData.firstName = firstName;
  if (lastName) updateData.lastName = lastName;
  if (language) updateData.language = language;

  if (newPassword) {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const valid = await bcrypt.compare(currentPassword || '', user!.password);
    if (!valid) return res.status(400).json({ message: 'Current password is incorrect' });
    updateData.password = await bcrypt.hash(newPassword, 12);
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: updateData,
    select: {
      id: true, email: true, username: true, firstName: true, lastName: true,
      role: true, language: true, updatedAt: true,
    },
  });

  return res.json({ data: updated });
});

export default router;
