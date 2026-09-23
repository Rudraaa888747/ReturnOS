import { Router } from 'express';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { creditBalance, creditHistory } from '../store.js';

export const creditRouter = Router();

creditRouter.use(requireAuth, requireCustomer);

creditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    res.json({ balancePaise: creditBalance(req.user.id), history: creditHistory(req.user.id) });
  }),
);
