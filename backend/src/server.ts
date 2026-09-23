import fs from 'node:fs';
import path from 'node:path';
import { app } from './app.js';
import { config } from './config.js';
import { initSchema } from './db.js';
import { tickFulfillment } from './fulfillment.js';
import { seedDatabase } from './seed.js';
import { countUsers } from './store.js';

function ensureDirectories(): void {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  if (config.databasePath !== ':memory:') {
    const dir = path.dirname(config.databasePath);
    if (dir !== '.' && dir !== '') {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

initSchema();
ensureDirectories();

// Seed the demo dataset on first boot when no users exist yet.
if (countUsers() === 0) {
  seedDatabase();
}

// Demo fulfillment cadence: advance due orders and returns once per tick.
// Production should use larger FULFILL_* delays via env (see fulfillment.ts).
if (config.nodeEnv !== 'test') {
  setInterval(() => {
    try {
      tickFulfillment();
    } catch (err) {
      // Never crash the server loop on a scheduler error.
      console.error('Fulfillment tick failed', err);
    }
  }, config.fulfillTickMs);
}

app.listen(config.port, () => {
  // Single startup line; request logging is handled by morgan.
  process.stdout.write(`ReturnOS backend listening on port ${config.port}\n`);
});
