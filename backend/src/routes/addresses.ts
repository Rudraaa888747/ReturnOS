import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { createAddress, deleteAddress, getAddress, listAddresses, updateAddress } from '../store.js';
import { addressPatchSchema, addressSchema } from '../validation.js';

export const addressesRouter = Router();

addressesRouter.use(requireAuth, requireCustomer);

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

addressesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ addresses: listAddresses(requireUserId(req.user?.id)) });
  }),
);

addressesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = validate(addressSchema, req.body);
    const address = createAddress(requireUserId(req.user?.id), body);
    res.status(201).json({ address });
  }),
);

addressesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const address = getAddress(requireUserId(req.user?.id), req.params.id);
    if (address === undefined) {
      throw httpError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
    }
    res.json({ address });
  }),
);

addressesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = validate(addressPatchSchema, req.body);
    const address = updateAddress(requireUserId(req.user?.id), req.params.id, body);
    res.json({ address });
  }),
);

addressesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteAddress(requireUserId(req.user?.id), req.params.id);
    res.json({ message: 'Address deleted' });
  }),
);
