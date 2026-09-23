import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { addTicketMessage, closeTicket, createTicket, getTicketDetail, listTickets } from '../store.js';
import { messageCreateSchema, ticketCreateSchema } from '../validation.js';

export const supportRouter = Router();

supportRouter.use(requireAuth, requireCustomer);

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

supportRouter.post(
  '/tickets',
  asyncHandler(async (req, res) => {
    const body = validate(ticketCreateSchema, req.body);
    const created = createTicket(requireUserId(req.user?.id), body);
    res.status(201).json(created);
  }),
);

supportRouter.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    res.json({ tickets: listTickets(requireUserId(req.user?.id)) });
  }),
);

supportRouter.get(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    const detail = getTicketDetail(requireUserId(req.user?.id), req.params.id);
    if (detail === null) {
      throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
    }
    res.json(detail);
  }),
);

supportRouter.post(
  '/tickets/:id/messages',
  asyncHandler(async (req, res) => {
    const body = validate(messageCreateSchema, req.body);
    const message = addTicketMessage(requireUserId(req.user?.id), req.params.id, body.body);
    if (message === null) {
      throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
    }
    res.status(201).json({ message });
  }),
);

supportRouter.post(
  '/tickets/:id/close',
  asyncHandler(async (req, res) => {
    const ticket = closeTicket(requireUserId(req.user?.id), req.params.id);
    if (ticket === null) {
      throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
    }
    res.json({ ticket });
  }),
);
