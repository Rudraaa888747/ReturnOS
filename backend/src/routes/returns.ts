import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { cancelReturn, createReturn, getReturnDetail, listReturnEvents, listReturns } from '../store.js';
import { cancelSchema, returnCreateSchema } from '../validation.js';

export const returnsRouter = Router();

returnsRouter.use(requireAuth, requireCustomer);

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

returnsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    const body = validate(returnCreateSchema, req.body);
    const detail = createReturn(customerId, body);
    res.status(201).json(detail);
  }),
);

returnsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    res.json({ returns: listReturns(customerId) });
  }),
);

returnsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    const detail = getReturnDetail(customerId, req.params.id);
    if (detail === null) {
      throw httpError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }
    res.json(detail);
  }),
);

returnsRouter.get(
  '/:id/timeline',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    const detail = getReturnDetail(customerId, req.params.id);
    if (detail === null) {
      throw httpError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }
    res.json({ events: listReturnEvents(req.params.id) });
  }),
);

returnsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const customerId = requireUserId(req.user?.id);
    const body = validate(cancelSchema, req.body);
    const updated = cancelReturn(customerId, req.params.id, body.reason);
    res.json({ ret: updated });
  }),
);
