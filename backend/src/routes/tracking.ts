import { Router } from 'express';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { findReturnByNumber, getReturnDetail } from '../store.js';

export const trackingRouter = Router();

trackingRouter.use(requireAuth, requireCustomer);

trackingRouter.get(
  '/:returnNumber',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const row = findReturnByNumber(req.params.returnNumber);
    // Missing and foreign numbers both map to 404 so that one customer can
    // never probe for another customer's returns.
    if (row === undefined || row.customer_id !== req.user.id) {
      throw httpError(404, 'TRACKING_NOT_FOUND', 'Return not found');
    }
    const detail = getReturnDetail(req.user.id, row.id);
    if (detail === null) {
      throw httpError(404, 'TRACKING_NOT_FOUND', 'Return not found');
    }
    res.json({
      returnNumber: detail.ret.return_number,
      status: detail.ret.status,
      resolutionType: detail.ret.resolution_type,
      updatedAt: detail.ret.updated_at,
      events: detail.events,
      pickup: detail.pickup,
      refund: detail.refund,
    });
  }),
);
