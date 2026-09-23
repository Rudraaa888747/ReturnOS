import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { createFeedback, getFeedbackByReturn } from '../store.js';
import { feedbackSchema } from '../validation.js';

export const feedbackRouter = Router();

feedbackRouter.use(requireAuth, requireCustomer);

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

feedbackRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const body = validate(feedbackSchema, req.body);
    const feedback = createFeedback(req.user.id, body);
    res.status(201).json({ feedback });
  }),
);

feedbackRouter.get(
  '/return/:returnId',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const feedback = getFeedbackByReturn(req.user.id, req.params.returnId);
    if (feedback === null) {
      throw httpError(404, 'FEEDBACK_NOT_FOUND', 'Feedback not found');
    }
    res.json({ feedback });
  }),
);
