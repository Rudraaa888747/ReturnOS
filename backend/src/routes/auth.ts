import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import {
  consumePasswordReset,
  createPasswordReset,
  createUser,
  findUserByEmail,
  findUserById,
  getProfile,
  updateUserPassword,
} from '../store.js';
import { hashPassword, comparePassword, hashToken, randomToken, signToken } from '../utils.js';
import { forgotSchema, loginSchema, resetSchema, signupSchema } from '../validation.js';

export const authRouter = Router();

function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

function publicUser(userId: string): { id: string; email: string; fullName: string; role: string } {
  const user = findUserById(userId);
  if (user === undefined) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return { id: user.id, email: user.email, fullName: user.full_name, role: user.role };
}

authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const body = validate(signupSchema, req.body);
    const existing = findUserByEmail(body.email);
    if (existing !== undefined) {
      throw httpError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
    }
    const user = createUser({ email: body.email, passwordHash: await hashPassword(body.password), fullName: body.fullName });
    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    res.status(201).json({ user: publicUser(user.id), token });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = validate(loginSchema, req.body);
    const user = findUserByEmail(body.email);
    if (user === undefined) {
      throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const ok = await comparePassword(body.password, user.password_hash);
    if (!ok) {
      throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (user.active !== 1) {
      throw httpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled');
    }
    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    res.json({ user: publicUser(user.id), token });
  }),
);

authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const body = validate(forgotSchema, req.body);
    const user = findUserByEmail(body.email);
    if (user !== undefined) {
      const raw = randomToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      createPasswordReset(user.id, hashToken(raw), expiresAt);
      // In non-production environments the token is returned so the customer
      // client (and automated tests) can complete the flow without an SMTP
      // server. Production deployments deliver it by email instead.
      if (process.env.NODE_ENV !== 'production') {
        res.json({ message: 'If the email exists, a reset link was created', resetToken: raw });
        return;
      }
    }
    res.json({ message: 'If the email exists, a reset link was created' });
  }),
);

authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const body = validate(resetSchema, req.body);
    const userId = consumePasswordReset(hashToken(body.token));
    if (userId === null) {
      throw httpError(400, 'INVALID_TOKEN', 'Reset token is invalid or expired');
    }
    await updateUserPassword(userId, await hashPassword(body.newPassword));
    res.json({ message: 'Password was reset successfully' });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const profile = getProfile(req.user.id);
    res.json({ user: publicUser(req.user.id), profile });
  }),
);
