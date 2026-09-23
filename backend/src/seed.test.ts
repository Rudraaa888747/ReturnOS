import { beforeAll, describe, expect, it } from 'vitest';
import { db, initSchema } from './db.js';
import { seedDatabase } from './seed.js';

/**
 * The demo dataset is the E2E starting line: the seeded return must be
 * walkable from the beginning (REQUESTED, no warehouse rows behind it),
 * never a status without substance.
 */
beforeAll(() => {
  initSchema();
  seedDatabase();
});

describe('demo seed stays walkable', () => {
  it('seeds r-2026-0841 as REQUESTED with no warehouse rows', () => {
    const ret = db.prepare('SELECT status, approved_at FROM returns WHERE id = ?').get('r-2026-0841') as {
      status: string;
      approved_at: string | null;
    };
    expect(ret.status).toBe('REQUESTED');
    expect(ret.approved_at).toBeNull();

    const events = db
      .prepare('SELECT status FROM return_events WHERE return_id = ? ORDER BY created_at ASC')
      .all('r-2026-0841') as Array<{ status: string }>;
    expect(events.map((event) => event.status)).toEqual(['REQUESTED']);

    const pickup = db.prepare('SELECT status FROM pickups WHERE return_id = ?').get('r-2026-0841') as {
      status: string;
    };
    expect(pickup.status).toBe('SCHEDULED');

    const refund = db.prepare('SELECT status FROM refunds WHERE return_id = ?').get('r-2026-0841') as {
      status: string;
    };
    expect(refund.status).toBe('PENDING');

    for (const table of ['receiving_records', 'inspections', 'dispositions'] as const) {
      const count = (
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE return_id = ?`).get('r-2026-0841') as {
          count: number;
        }
      ).count;
      expect(count).toBe(0);
    }
  });
});
