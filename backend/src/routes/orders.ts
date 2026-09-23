import { Router } from 'express';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { getOrderDetail, getOrderTracking, listOrders } from '../store.js';

export const ordersRouter = Router();

ordersRouter.use(requireAuth, requireCustomer);

ordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    res.json({ orders: listOrders(req.user.id) });
  }),
);

ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    // Ownership is enforced inside the store; foreign or missing orders map
    // to 404 so account enumeration is impossible.
    const detail = getOrderDetail(req.user.id, req.params.id);
    if (detail === null) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    res.json(detail);
  }),
);

ordersRouter.get(
  '/:id/tracking',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    // getOrderTracking throws 404 for foreign or missing orders.
    res.json(getOrderTracking(req.user.id, req.params.id));
  }),
);
