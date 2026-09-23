import { z } from 'zod';
import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import type { TaskKind } from '../warehouse/schema.js';
import { auditAdminWrite } from './audit.js';

/**
 * DB-backed operational settings.
 *
 * Each key below used to be a hardcoded const or an env default. The values
 * seed from the exact old constants (so behavior is identical day one) and
 * the engines read them live from this table instead. Rule structure (which
 * reasons map to which resolutions, which stages exist) stays in code and
 * tested — only the tunable parameters moved.
 *
 * Read path: validated, falling back to the compiled default when a stored
 * value fails validation, so a bad admin write can never take down the
 * shopper flow. Writes are strictly validated and audited. GET /settings
 * reports stored vs effective vs valid per key, so an invalid row is
 * visible in admin instead of silent.
 */

const slaMapSchema = z.object({
  RECEIVE_RETURN: z.number().int().min(0).max(720),
  INSPECT_ITEM: z.number().int().min(0).max(720),
  PROCESS_DISPOSITION: z.number().int().min(0).max(720),
  REVIEW_APPROVAL: z.number().int().min(0).max(720),
  RESTOCK: z.number().int().min(0).max(720),
  PACKAGE_REPLACEMENT: z.number().int().min(0).max(720),
  PREPARE_EXCHANGE: z.number().int().min(0).max(720),
  VERIFY_SHIPMENT: z.number().int().min(0).max(720),
});

export const SETTING_DEFINITIONS = {
  RETURN_WINDOW_DAYS: {
    schema: z.number().int().min(1).max(365),
    default: 30,
    description: 'Days after delivery during which a return can be started.',
  },
  CHANGED_MIND_REFUND_DAYS: {
    schema: z.number().int().min(0).max(365),
    default: 14,
    description: 'Days after delivery during which a change-of-mind return still offers a refund; afterwards store credit only.',
  },
  TASK_SLA_HOURS: {
    schema: slaMapSchema,
    default: {
      RECEIVE_RETURN: 24,
      INSPECT_ITEM: 24,
      PROCESS_DISPOSITION: 48,
      REVIEW_APPROVAL: 8,
      RESTOCK: 24,
      PACKAGE_REPLACEMENT: 48,
      PREPARE_EXCHANGE: 48,
      VERIFY_SHIPMENT: 12,
    } as Record<TaskKind, number>,
    description: 'Hours allowed per warehouse task kind before it counts as overdue. Applies to tasks created after the change.',
  },
  FREE_SHIPPING_THRESHOLD_PAISE: {
    schema: z.number().int().min(0).max(100_000_000),
    default: 299900,
    description: 'Basket subtotal in paise at or above which shipping is free.',
  },
  FLAT_SHIPPING_PAISE: {
    schema: z.number().int().min(0).max(100_000_000),
    default: 9900,
    description: 'Flat shipping fee in paise below the free-shipping threshold.',
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export function isSettingKey(value: string): value is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, value);
}

function readRaw(key: SettingKey): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function parseStored<T>(key: SettingKey): { ok: true; value: T } | { ok: false } {
  const raw = readRaw(key);
  if (raw === undefined) {
    return { ok: false };
  }
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const result = (SETTING_DEFINITIONS[key].schema as z.ZodTypeAny).safeParse(parsed);
  if (!result.success) {
    return { ok: false };
  }
  return { ok: true, value: result.data as T };
}

/** Deep-clone a JSON-safe default without relying on globals. */
function cloneDefault<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Validated value, or the compiled default when missing or invalid. */
export function getSetting(key: SettingKey): unknown {
  const parsed = parseStored<unknown>(key);
  if (parsed.ok) {
    return parsed.value;
  }
  return cloneDefault(SETTING_DEFINITIONS[key].default);
}

export function getReturnWindowDays(): number {
  return getSetting('RETURN_WINDOW_DAYS') as number;
}

export function getChangedMindRefundDays(): number {
  return getSetting('CHANGED_MIND_REFUND_DAYS') as number;
}

export function getTaskSlaHours(): Record<TaskKind, number> {
  return getSetting('TASK_SLA_HOURS') as Record<TaskKind, number>;
}

export function getShippingPolicy(): { thresholdPaise: number; flatPaise: number } {
  return {
    thresholdPaise: getSetting('FREE_SHIPPING_THRESHOLD_PAISE') as number,
    flatPaise: getSetting('FLAT_SHIPPING_PAISE') as number,
  };
}

export interface SettingState {
  key: SettingKey;
  description: string;
  stored: unknown;
  effective: unknown;
  valid: boolean;
  default: unknown;
}

/** Every known key with stored vs effective values, for the admin screen. */
export function getSettingsState(): SettingState[] {
  return (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => {
    const parsed = parseStored<unknown>(key);
    const def = SETTING_DEFINITIONS[key];
    return {
      key,
      description: def.description,
      stored: parsed.ok ? parsed.value : readRaw(key) ?? null,
      effective: parsed.ok ? parsed.value : cloneDefault(def.default),
      valid: parsed.ok,
      default: cloneDefault(def.default),
    };
  });
}

export interface SettingWrite {
  actorId: string;
  ip?: string | null;
}

/** Validate + persist one setting, audited with before/after. Unknown keys 400. */
export function setSetting(write: SettingWrite, key: string, value: unknown): SettingState {
  // Transaction opened call-time, not module-time: this module is imported
  // by db.ts itself, so a top-level db.transaction() would evaluate against
  // an uninitialised circular import.
  return db.transaction((): SettingState => {
    if (!isSettingKey(key)) {
      throw new HttpError(400, 'UNKNOWN_SETTING', `Unknown setting: ${key}`);
    }
    const def = SETTING_DEFINITIONS[key];
    const parsed = (def.schema as z.ZodTypeAny).safeParse(value);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `Invalid value for ${key}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    const before = readRaw(key) ?? null;
    const stored = JSON.stringify(parsed.data);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(key, stored, write.actorId, now);
    auditAdminWrite({
      actorId: write.actorId,
      action: 'SETTING_UPDATED',
      entityType: 'SETTING',
      entityId: key,
      before,
      after: stored,
      ip: write.ip,
    });
    const state = getSettingsState().find((entry) => entry.key === key);
    if (state === undefined) {
      throw new HttpError(500, 'SETTING_ERROR', `Setting could not be loaded after update: ${key}`);
    }
    return state;
  })();
}

/** Seed compiled defaults without touching admin-customised rows. */
export function seedSettings(defaults: Partial<Record<SettingKey, unknown>> = {}): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, NULL, ?)',
  );
  const run = db.transaction(() => {
    for (const key of Object.keys(SETTING_DEFINITIONS) as SettingKey[]) {
      const value = defaults[key] !== undefined ? defaults[key] : SETTING_DEFINITIONS[key].default;
      insert.run(key, JSON.stringify(value), now);
    }
  });
  run();
}
