import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { getReturnWindowDays } from '../admin/settings.js';
import { listActiveReasons } from '../store.js';

export const metaRouter = Router();

metaRouter.get(
  '/reasons',
  asyncHandler(async (_req, res) => {
    res.json({ reasons: listActiveReasons() });
  }),
);

metaRouter.get(
  '/constants',
  asyncHandler(async (_req, res) => {
    res.json({
      resolutionTypes: ['REFUND', 'REPLACEMENT', 'EXCHANGE', 'STORE_CREDIT'],
      pickupKinds: ['PICKUP', 'DROP_OFF'],
      returnWindowDays: getReturnWindowDays(),
      returnStatuses: ['REQUESTED', 'APPROVED', 'INSPECTION', 'RESOLVED', 'REJECTED', 'CANCELLED'],
    });
  }),
);
