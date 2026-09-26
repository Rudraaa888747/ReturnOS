import { resetJavaDb } from './dbpg.js';

// Java-target global setup: reset the PostgreSQL E2E database to an empty
// schema before the suite runs. Playwright starts the Java backend after
// this, and Flyway migrates (V1..V7 incl. demo seed) on boot, so every run
// starts from the same deterministic baseline — the replacement for the old
// `trim:orders` SQLite reset. Only touches the E2E database (never prod).
export default async function globalSetup(): Promise<void> {
  await resetJavaDb();
}
