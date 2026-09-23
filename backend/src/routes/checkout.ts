import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { checkout, quoteCheckout } from '../store.js';
import { checkoutSchema, quoteSchema } from '../validation.js';

export const checkoutRouter = Router();

checkoutRouter.use(requireAuth, requireCustomer);

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

function requireUserId(reqUserId: string | undefined): string {
  if (reqUserId === undefined) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return reqUserId;
}

checkoutRouter.post(
  '/quote',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    const body = validate(quoteSchema, req.body);
    res.json(quoteCheckout(customerId, body));
  }),
);

checkoutRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    const body = validate(checkoutSchema, req.body);
    const result = checkout(customerId, body);
    res.status(result.replayed ? 200 : 201).json(result.detail);
  }),
);
