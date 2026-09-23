import { z } from 'zod';
import {
  CONDITION_GRADES,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  DISPOSITION_ACTIONS,
  INSPECTION_RESULTS,
  MOVEMENT_REASONS,
  PACKAGE_CONDITIONS,
  RECEIVING_DISCREPANCIES,
} from './schema.js';

/**
 * Request schemas for the warehouse API.
 *
 * Every controlled value is validated against the same const arrays the
 * database CHECK constraints are built from, so an invalid state is rejected
 * at the edge with a readable message rather than as a constraint failure.
 */

export const receiveSchema = z.object({
  packageCondition: z.enum(PACKAGE_CONDITIONS),
  discrepancy: z.enum(RECEIVING_DISCREPANCIES).default('NONE'),
  receivedQuantity: z.number().int().min(0, 'Received quantity cannot be negative'),
  trackingNumber: z.string().max(80).optional().nullable(),
  carrier: z.string().max(80).optional().nullable(),
  locationId: z.string().min(1).max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const inspectionFindingSchema = z.object({
  returnItemId: z.string().min(1, 'Return item id is required'),
  result: z.enum(INSPECTION_RESULTS),
  productCondition: z.enum(CONDITION_GRADES),
  packagingCondition: z.enum(CONDITION_GRADES),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  missingComponents: z.string().max(500).optional().nullable(),
  damageNotes: z.string().max(2000).optional().nullable(),
  serialNumber: z.string().max(120).optional().nullable(),
});

export const completeInspectionSchema = z.object({
  findings: z.array(inspectionFindingSchema).min(1, 'Record at least one finding'),
  notes: z.string().max(2000).optional().nullable(),
});

export const dispositionSchema = z.object({
  returnItemId: z.string().min(1, 'Return item id is required'),
  action: z.enum(DISPOSITION_ACTIONS),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  locationId: z.string().min(1).max(80).optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  recoveryValuePaise: z.number().int().min(0).max(100_000_000).optional(),
});

/** Pagination and filters shared by the list endpoints. */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  productId: z.string().max(80).optional(),
  reason: z.enum(MOVEMENT_REASONS).optional(),
});

export const taskQuerySchema = listQuerySchema.extend({
  kind: z.enum(TASK_KINDS).optional(),
  taskStatus: z.enum(TASK_STATUSES).optional(),
  assignedTo: z.string().max(80).optional(),
  overdueOnly: z.coerce.boolean().optional(),
});

export const taskUpdateSchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    assignedTo: z.string().max(80).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    blockedReason: z.string().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const analyticsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});

export const auditQuerySchema = listQuerySchema.extend({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
  actorId: z.string().max(80).optional(),
});

export type ReceiveBody = z.infer<typeof receiveSchema>;
export type CompleteInspectionBody = z.infer<typeof completeInspectionSchema>;
export type DispositionBody = z.infer<typeof dispositionSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
