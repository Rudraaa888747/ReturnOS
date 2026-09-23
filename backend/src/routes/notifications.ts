import { Router } from 'express';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../store.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth, requireCustomer);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const unreadParam = req.query.unreadOnly;
    const unreadOnly = unreadParam === 'true' || unreadParam === '1';
    res.json({ notifications: listNotifications(req.user.id, unreadOnly) });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const updated = markNotificationRead(req.user.id, req.params.id);
    if (!updated) {
      throw httpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    }
    res.json({ message: 'Notification marked as read' });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const updated = markAllNotificationsRead(req.user.id);
    res.json({ message: 'All notifications marked as read', updated });
  }),
);
