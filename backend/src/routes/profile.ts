import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { findUserById, getProfile, updateUserFullName, updateUserPassword, upsertProfile } from '../store.js';
import { comparePassword, hashPassword } from '../utils.js';
import { changePasswordSchema, profilePatchSchema, settingsPatchSchema } from '../validation.js';

export const profileRouter = Router();

profileRouter.use(requireAuth, requireCustomer);

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

function parsePrefs(raw: string): Record<string, boolean> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}

profileRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const user = findUserById(req.user.id);
    if (user === undefined) {
      throw httpError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const profile = getProfile(req.user.id);
    res.json({
      user: publicUser(req.user.id),
      profile: {
        ...profile,
        commPrefs: parsePrefs(profile.comm_prefs),
        notifPrefs: parsePrefs(profile.notif_prefs),
      },
    });
  }),
);

profileRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const body = validate(profilePatchSchema, req.body);
    if (body.fullName !== undefined) {
      updateUserFullName(req.user.id, body.fullName);
    }
    const profile = upsertProfile(req.user.id, { phone: body.phone });
    res.json({ user: publicUser(req.user.id), profile });
  }),
);

profileRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const body = validate(settingsPatchSchema, req.body);
    const profile = upsertProfile(req.user.id, {
      commPrefs: body.commPrefs,
      notifPrefs: body.notifPrefs,
    });
    res.json({
      profile: {
        ...profile,
        commPrefs: parsePrefs(profile.comm_prefs),
        notifPrefs: parsePrefs(profile.notif_prefs),
      },
    });
  }),
);

profileRouter.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const body = validate(changePasswordSchema, req.body);
    const user = findUserById(req.user.id);
    if (user === undefined) {
      throw httpError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const ok = await comparePassword(body.currentPassword, user.password_hash);
    if (!ok) {
      throw httpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    await updateUserPassword(req.user.id, await hashPassword(body.newPassword));
    res.json({ message: 'Password changed successfully' });
  }),
);
