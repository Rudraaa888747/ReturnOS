import { beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { initSchema } from './db.js';
import { seedDatabase } from './seed.js';
import { allowedResolutions, createOrder, createUser, getOrderDetail } from './store.js';
import { FREE_SHIPPING_THRESHOLD_PAISE, FLAT_SHIPPING_PAISE } from './store.js';
import { TASK_SLA_HOURS } from './warehouse/schema.js';

/**
 * Compatibility pins for the settings refactor.
 *
 * These tests capture the behavior the hardcoded constants produce TODAY.
 * They must pass unchanged before AND after the settings table takes over,
 * which is the concrete evidence the refactor changed nothing for existing
 * customer and warehouse flows. All margins are half-days: exact-day
 * boundaries would flake on millisecond timing.
 */

function daysAgoIsoFloat(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function uniqueOrder(prefix: string): string {
  return `ORD-CMP-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function signupCustomer(prefix: string): Promise<{ id: string }> {
  const row = createUser({
    email: `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`,
    passwordHash: bcrypt.hashSync('Password123', 10),
    fullName: `${prefix} Customer`,
  });
  return { id: row.id };
}

let customerId: string;

beforeAll(() => {
  initSchema();
  seedDatabase();
});

describe('return window boundary (30 days today)', () => {
  it('keeps a 29.5-day-old delivery eligible', async () => {
    customerId = (await signupCustomer('cmp')).id;
    const order = createOrder({
      orderNumber: uniqueOrder('win-in'),
      customerId,
      status: 'DELIVERED',
      createdAt: daysAgoIsoFloat(32),
      deliveredAt: daysAgoIsoFloat(29.5),
      items: [{ productId: 'p-tee', sku: 'T', productName: 'Tee', quantity: 1, unitPrice: 10 }],
    });
    const detail = getOrderDetail(customerId, order.id);
    expect(detail?.eligible).toBe(true);
    const until = new Date(detail?.eligibleUntil as string);
    const delivered = new Date(order.delivered_at as string);
    expect(until.toISOString().slice(0, 10)).toBe(
      new Date(delivered.getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
    );
  });

  it('expires a 30.5-day-old delivery', async () => {
    const order = createOrder({
      orderNumber: uniqueOrder('win-out'),
      customerId,
      status: 'DELIVERED',
      createdAt: daysAgoIsoFloat(33),
      deliveredAt: daysAgoIsoFloat(30.5),
      items: [{ productId: 'p-tee', sku: 'T', productName: 'Tee', quantity: 1, unitPrice: 10 }],
    });
    const detail = getOrderDetail(customerId, order.id);
    expect(detail?.eligible).toBe(false);
    expect(detail?.ineligibleReason).toBe('Return window expired');
  });
});

describe('change-of-mind degrade point (14 days today)', () => {
  it('offers refund and credit at 13.5 days', () => {
    const allowed = allowedResolutions(['CHANGED_MIND'], daysAgoIsoFloat(13.5));
    expect(allowed.has('REFUND')).toBe(true);
    expect(allowed.has('STORE_CREDIT')).toBe(true);
  });

  it('degrades to credit only at 14.5 days', () => {
    expect(allowedResolutions(['CHANGED_MIND'], daysAgoIsoFloat(14.5))).toEqual(new Set(['STORE_CREDIT']));
  });

  it('keeps the defective set exactly refund-family', () => {
    expect(allowedResolutions(['DEFECTIVE'], daysAgoIsoFloat(2))).toEqual(
      new Set(['REFUND', 'REPLACEMENT', 'EXCHANGE']),
    );
  });
});

describe('warehouse SLA ladder (hours today)', () => {
  it('matches the published per-kind map', () => {
    expect(TASK_SLA_HOURS).toEqual({
      RECEIVE_RETURN: 24,
      INSPECT_ITEM: 24,
      PROCESS_DISPOSITION: 48,
      REVIEW_APPROVAL: 8,
      RESTOCK: 24,
      PACKAGE_REPLACEMENT: 48,
      PREPARE_EXCHANGE: 48,
      VERIFY_SHIPMENT: 12,
    });
  });
});

describe('shipping policy (paise today)', () => {
  it('matches the published threshold and flat fee', () => {
    expect(FREE_SHIPPING_THRESHOLD_PAISE).toBe(299900);
    expect(FLAT_SHIPPING_PAISE).toBe(9900);
  });
});
