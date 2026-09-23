import { z } from 'zod';

/** Filters shared by the admin audit list endpoint. */
export const adminAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().max(80).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
  actorId: z.string().max(80).optional(),
});

export type AdminAuditQueryInput = z.infer<typeof adminAuditQuerySchema>;

const paging = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
};

const optionalDate = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid date' })
  .optional();

const sortDir = z.string().max(10).optional();

/** Unknown sort keys fall back to the reader default; direction sanitizes to ASC. */
export const adminCustomersQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  sort: z.string().max(40).optional().default('created_at'),
  dir: sortDir,
});

export const adminOrdersQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  customerId: z.string().max(80).optional(),
  from: optionalDate,
  to: optionalDate,
  sort: z.string().max(40).optional().default('created_at'),
  dir: sortDir,
});

export const adminReturnsQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  resolution: z.string().max(40).optional(),
  customerId: z.string().max(80).optional(),
  productId: z.string().max(80).optional(),
  warehouseId: z.string().max(80).optional(),
  from: optionalDate,
  to: optionalDate,
  sort: z.string().max(40).optional().default('created_at'),
  dir: sortDir,
});

export const adminWarehouseUsersQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  warehouseId: z.string().max(80).optional(),
});

export const adminWorkloadQuerySchema = z.object({
  ...paging,
  warehouseId: z.string().max(80).optional(),
  status: z.string().max(40).optional(),
  priority: z.string().max(40).optional(),
  assignedTo: z.string().max(80).optional(),
  from: optionalDate,
  to: optionalDate,
});

export const adminInventoryQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
});

export const adminMovementsQuerySchema = z.object({
  ...paging,
  warehouseId: z.string().max(80).optional(),
  productId: z.string().max(80).optional(),
  reason: z.string().max(40).optional(),
});

export const adminAnalyticsQuerySchema = z.object({
  warehouseId: z.string().max(80).optional(),
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});

export const adminSettingBodySchema = z.object({
  value: z.unknown(),
});

export const adminReasonBodySchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export const adminReasonPatchSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export const adminCreditAdjustSchema = z.object({
  userId: z.string().min(1).max(80),
  direction: z.enum(['CREDIT', 'DEBIT']),
  amountPaise: z.number().int().min(1).max(100_000_000),
  reason: z.string().min(8).max(2000),
  key: z.string().uuid(),
});

export const adminLedgerQuerySchema = z.object({
  ...paging,
  userId: z.string().max(80).optional(),
  type: z.enum(['CREDIT', 'DEBIT', 'ADJUSTMENT']).optional(),
  referenceType: z.string().max(40).optional(),
});

export const adminRefundsQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  kind: z.string().max(40).optional(),
});

export const adminLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminTicketsQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().max(80).optional(),
  customerId: z.string().max(80).optional(),
});

export const adminTicketAssignSchema = z.object({
  assignedTo: z.string().max(80).nullable(),
});

export const adminTicketStatusSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
});

export const adminTicketUpdateSchema = z.object({
  assignedTo: z.string().max(80).nullable().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
});

export const adminTicketReplySchema = z.object({
  body: z.string().min(1).max(5000),
});

export const adminTemplateBodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  active: z.boolean().optional(),
});

export const adminNotificationsQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  type: z.string().max(40).optional(),
  userId: z.string().max(80).optional(),
  unreadOnly: z.coerce.boolean().optional(),
});

export const adminCustomerPatchSchema = z.object({
  active: z.boolean(),
});

export const adminUserBodySchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  fullName: z.string().min(1).max(200),
});

export const adminUserPatchSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
  role: z.enum(['ADMIN', 'CUSTOMER']).optional(),
});

export const adminUsersQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  role: z.enum(['ADMIN', 'CUSTOMER', 'WAREHOUSE']).optional(),
  active: z.enum(['true', 'false']).optional(),
});

export const adminReportQuerySchema = z.object({
  search: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  resolution: z.string().max(40).optional(),
  kind: z.string().max(40).optional(),
  userId: z.string().max(80).optional(),
  type: z.string().max(40).optional(),
  warehouseId: z.string().max(80).optional(),
  productId: z.string().max(80).optional(),
  reason: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
});

export const adminWarehouseBodySchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  city: z.string().max(200).optional(),
  active: z.boolean().optional(),
});

export const adminWarehousePatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  city: z.string().max(200).optional(),
  active: z.boolean().optional(),
});

export const adminOperatorBodySchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  fullName: z.string().min(1).max(200),
  warehouseId: z.string().min(1).max(80),
});

export const adminOperatorPatchSchema = z.object({
  warehouseId: z.string().min(1).max(80).optional(),
  active: z.boolean().optional(),
});

const activeFlag = z.enum(['true', 'false']).optional();

export const adminProductsQuerySchema = z.object({
  ...paging,
  search: z.string().max(120).optional(),
  active: activeFlag,
  categoryId: z.string().max(80).optional(),
  sort: z.string().max(40).optional().default('name'),
  dir: sortDir,
});

export const adminCategoryBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  active: z.boolean().optional(),
});

export const adminCategoryPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  active: z.boolean().optional(),
});

export const adminProductBodySchema = z.object({
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  details: z.string().max(4000).optional(),
  pricePaise: z.number().int().min(0).max(100_000_000),
  imageUrl: z.string().max(2000).optional(),
  stock: z.number().int().min(0).max(1_000_000),
  categoryId: z.string().max(80).nullable().optional(),
  active: z.boolean().optional(),
});

export const adminProductPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  details: z.string().max(4000).optional(),
  imageUrl: z.string().max(2000).optional(),
  pricePaise: z.number().int().min(0).max(100_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  categoryId: z.string().max(80).nullable().optional(),
  active: z.boolean().optional(),
});
