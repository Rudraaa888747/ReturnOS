import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { addToCart, getCart, removeFromCart, setCartQuantity } from '../store.js';
import { cartAddSchema, cartSetSchema } from '../validation.js';

export const cartRouter = Router();

cartRouter.use(requireAuth, requireCustomer);

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

cartRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(getCart(requireUserId(req.user?.id)));
  }),
);

cartRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    const body = validate(cartAddSchema, req.body);
    res.status(201).json(addToCart(customerId, body.productId, body.quantity));
  }),
);

cartRouter.patch(
  '/:productId',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    const body = validate(cartSetSchema, req.body);
    res.json(setCartQuantity(customerId, req.params.productId, body.quantity));
  }),
);

cartRouter.delete(
  '/:productId',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    res.json(removeFromCart(customerId, req.params.productId));
  }),
);
