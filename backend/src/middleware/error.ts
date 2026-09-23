import type { NextFunction, Request, Response } from 'express';

/** Error shape returned to API clients. Stacks are never included. */
export interface ApiErrorBody {
  code: string;
  message: string;
  errors?: unknown;
}

/** Typed HTTP error thrown by routes and the store layer. */
export class HttpError extends Error {
  status: number;
  code: string;
  errors: unknown;

  constructor(status: number, code: string, message: string, errors?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

/** Create an HTTP error with an optional machine-readable errors payload. */
export function httpError(status: number, code: string, message: string, errors?: unknown): HttpError {
  return new HttpError(status, code, message, errors);
}

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/**
 * Wrap an async route handler so rejected promises reach the error handler.
 * Express 4 does not catch async errors on its own.
 */
export function asyncHandler(fn: AsyncRoute): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Catch-all for unknown routes under the API. */
export function notFound(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    code: 'NOT_FOUND',
    message: `Route not found: ${req.method} ${req.path}`,
  };
  res.status(404).json(body);
}

/** Central error handler. Never leaks stack traces in production. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof HttpError) {
    const body: ApiErrorBody = { code: err.code, message: err.message };
    if (err.errors !== undefined) {
      body.errors = err.errors;
    }
    res.status(err.status).json(body);
    return;
  }

  const body: ApiErrorBody = {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
  void req;
  res.status(500).json(body);
}
