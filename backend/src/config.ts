import dotenv from 'dotenv';

// Load variables from a local .env file when present. Real environments
// provide values directly, which take precedence over the file.
dotenv.config();

function parsePort(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 8080;
}

function parseReturnWindow(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 30;
}

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret !== undefined && secret.length > 0) {
    return secret;
  }
  // Tests run without a real .env file; use a fixed development secret so the
  // suite can sign tokens without weakening the production requirement.
  if (process.env.NODE_ENV === 'test') {
    return 'test-only-jwt-secret';
  }
  throw new Error('JWT_SECRET environment variable is required');
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isTest = nodeEnv === 'test';

function parseTickMs(raw: string | undefined): number {
  const fallback = 60_000;
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 250 ? parsed : fallback;
}

export const config = {
  nodeEnv,
  isTest,
  port: parsePort(process.env.PORT),
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  // Test runs use an in-memory database so suites stay isolated and never
  // touch the developer database file on disk.
  databasePath: isTest ? ':memory:' : (process.env.DATABASE_PATH ?? './data/returnos.db'),
  // Test uploads go to a separate folder to keep the workspace clean.
  uploadDir: isTest ? './uploads-test' : (process.env.UPLOAD_DIR ?? './uploads'),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? '',
  returnWindowDays: parseReturnWindow(process.env.RETURN_WINDOW_DAYS),
  // Cadence of the fulfillment scheduler. Configurable so an end-to-end run can
  // drive the real lifecycle quickly instead of writing stage rows by hand.
  fulfillTickMs: parseTickMs(process.env.FULFILL_TICK_MS),
  // Optional single-origin production deployment: when FRONTEND_DIST points
  // at a built frontend bundle, the API server also serves it (SPA fallback).
  frontendDist: process.env.FRONTEND_DIST ?? '',
};
