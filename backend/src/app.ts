import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/error.js';
import { addressesRouter } from './routes/addresses.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { cartRouter } from './routes/cart.js';
import { checkoutRouter } from './routes/checkout.js';
import { creditRouter } from './routes/credit.js';
import { documentsRouter } from './routes/documents.js';
import { feedbackRouter } from './routes/feedback.js';
import { metaRouter } from './routes/meta.js';
import { notificationsRouter } from './routes/notifications.js';
import { ordersRouter } from './routes/orders.js';
import { productsRouter } from './routes/products.js';
import { profileRouter } from './routes/profile.js';
import { returnsRouter } from './routes/returns.js';
import { supportRouter } from './routes/support.js';
import { trackingRouter } from './routes/tracking.js';
import { uploadsRouter } from './routes/uploads.js';
import { warehouseRouter } from './routes/warehouse.js';

export const app = express();

app.use(helmet());
app.use(
  cors({
    // When no frontend origin is configured, reflect the request origin so
    // local development clients keep working.
    origin: config.frontendOrigin.length > 0 ? [config.frontendOrigin] : true,
    credentials: true,
  }),
);
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'returnos-backend' });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/profile', profileRouter);
app.use('/api/v1/products', productsRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/checkout', checkoutRouter);
app.use('/api/v1/credit', creditRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/meta', metaRouter);
app.use('/api/v1/returns', returnsRouter);
app.use('/api/v1/tracking', trackingRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/addresses', addressesRouter);
app.use('/api/v1/documents', documentsRouter);
app.use('/api/v1/support', supportRouter);
app.use('/api/v1/feedback', feedbackRouter);
app.use('/api/v1/uploads', uploadsRouter);
app.use('/api/v1/warehouse', warehouseRouter);

// Uploaded evidence is never exposed as a static folder. Files are served
// only through the documents download route, which enforces ownership.
// Malformed JSON bodies get a 400 with a customer-friendly message instead
// of falling through to the generic 500 handler.
function jsonParseError(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ code: 'INVALID_JSON', message: 'Request body is not valid JSON' });
    return;
  }
  next(err);
}

// Optional single-origin production deployment. When FRONTEND_DIST is set to
// a built frontend directory, serve it and fall back to index.html for
// non-API routes so browser-routed pages work on refresh.
if (config.frontendDist.length > 0 && fs.existsSync(config.frontendDist)) {
  app.use(express.static(config.frontendDist));
  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(path.resolve(config.frontendDist), 'index.html'), (err: Error | null) => {
      if (err !== null && err !== undefined) {
        next();
      }
    });
  });
}

app.use(notFound);
app.use(jsonParseError);
app.use(errorHandler);
