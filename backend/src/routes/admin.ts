import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { listAdminAudit } from '../admin/audit.js';
import { ADMIN_PERMISSIONS } from '../admin/permissions.js';
import {
  adminAnalyticsQuerySchema,
  adminAuditQuerySchema,
  adminCategoryBodySchema,
  adminCategoryPatchSchema,
  adminCreditAdjustSchema,
  adminCustomerPatchSchema,
  adminCustomersQuerySchema,
  adminInventoryQuerySchema,
  adminLedgerQuerySchema,
  adminLimitQuerySchema,
  adminMovementsQuerySchema,
  adminNotificationsQuerySchema,
  adminOperatorBodySchema,
  adminOperatorPatchSchema,
  adminOrdersQuerySchema,
  adminProductBodySchema,
  adminProductPatchSchema,
  adminProductsQuerySchema,
  adminReasonBodySchema,
  adminReasonPatchSchema,
  adminRefundsQuerySchema,
  adminReportQuerySchema,
  adminReturnsQuerySchema,
  adminSettingBodySchema,
  adminTemplateBodySchema,
  adminTicketReplySchema,
  adminTicketUpdateSchema,
  adminTicketsQuerySchema,
  adminUserBodySchema,
  adminUserPatchSchema,
  adminUsersQuerySchema,
  adminWarehouseBodySchema,
  adminWarehousePatchSchema,
  adminWarehouseUsersQuerySchema,
  adminWorkloadQuerySchema,
} from '../admin/validation.js';
import {
  createCategory,
  createProduct,
  deleteCategory,
  getCategoryAdmin,
  getProductAdmin,
  listCategoriesAdmin,
  listProductsAdmin,
  updateCategory,
  updateProduct,
} from '../admin/catalog.js';
import {
  adjustCredit,
  getRefundAdmin,
  listBalancesAdmin,
  listLedgerAdmin,
  listRefundsAdmin,
} from '../admin/finance.js';
import {
  createAdminUser,
  listAdminUsers,
  setCustomerActive,
  updateAdminUser,
} from '../admin/users.js';
import {
  assignTicket,
  getTicketAdmin,
  listTicketsAdmin,
  replyTicket,
  setTicketPriority,
  setTicketStatus,
} from '../admin/support.js';
import {
  listNotificationsAdmin,
  listTemplatesAdmin,
  upsertTemplate,
} from '../admin/notifications.js';
import {
  createOperator,
  createWarehouse,
  getWarehouseAdmin,
  updateOperator,
  updateWarehouse,
} from '../admin/sites.js';
import {
  creditReport,
  inventoryReport,
  movementsReport,
  ordersReport,
  refundsReport,
  returnsReport,
} from '../admin/reports.js';
import { createReason, listReasonsAdmin, updateReason } from '../admin/policy.js';
import { getSettingsState, setSetting } from '../admin/settings.js';
import {
  adminAnalytics,
  adminDashboard,
  getCustomerDetail,
  getOrderAdmin,
  getReturnAdmin,
  listCustomers,
  listInventoryAdmin,
  listMovementsAdmin,
  listOrdersAdmin,
  listReturnsAdmin,
  listWarehouseUsers,
  listWarehousesAdmin,
  sortDir,
  warehouseWorkload,
} from '../admin/readers.js';

export const adminRouter = Router();

// Every route below requires the ADMIN role verified against the database
// on each request. Frontend guards are never sufficient on their own.
adminRouter.use(requireAuth, requireAdmin());

function validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** Who the caller is, plus the permission strings this backend recognises. */
adminRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({
      user: { id: req.user?.id, email: req.user?.email, role: req.user?.role },
      permissions: [...ADMIN_PERMISSIONS],
    });
  }),
);

/**
 * Admin audit trail, read-only by design. There is no route that writes,
 * edits or deletes an audit row: the trail is append-only from the API's
 * point of view, exactly like the warehouse audit log.
 */
adminRouter.get(
  '/audit',
  requireAdmin('AUDIT_VIEW'),
  asyncHandler(async (req, res) => {
    const parsed = adminAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw httpError(
        400,
        'VALIDATION_ERROR',
        'Request validation failed',
        parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }
    const query = parsed.data;
    res.json(
      listAdminAudit({
        action: query.action,
        entityType: query.entityType,
        entityId: query.entityId,
        actorId: query.actorId,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

adminRouter.get(
  '/summary',
  requireAdmin('ADMIN_DASHBOARD_VIEW'),
  asyncHandler(async (_req, res) => {
    res.json(adminDashboard());
  }),
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

adminRouter.get(
  '/customers',
  requireAdmin('CUSTOMER_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminCustomersQuerySchema, req.query);
    res.json(
      listCustomers({
        search: query.search,
        sort: query.sort,
        dir: sortDir(query.dir, 'DESC'),
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/customers/:id',
  requireAdmin('CUSTOMER_VIEW'),
  asyncHandler(async (req, res) => {
    const detail = getCustomerDetail(req.params.id);
    if (detail === null) {
      throw httpError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    res.json(detail);
  }),
);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

adminRouter.get(
  '/orders',
  requireAdmin('ORDER_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminOrdersQuerySchema, req.query);
    res.json(
      listOrdersAdmin({
        search: query.search,
        status: query.status,
        customerId: query.customerId,
        from: query.from,
        to: query.to,
        sort: query.sort,
        dir: sortDir(query.dir, 'DESC'),
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/orders/:id',
  requireAdmin('ORDER_VIEW'),
  asyncHandler(async (req, res) => {
    const detail = getOrderAdmin(req.params.id);
    if (detail === null) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    res.json(detail);
  }),
);

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

adminRouter.get(
  '/returns',
  requireAdmin('RETURN_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminReturnsQuerySchema, req.query);
    res.json(
      listReturnsAdmin({
        search: query.search,
        status: query.status,
        resolution: query.resolution,
        customerId: query.customerId,
        productId: query.productId,
        warehouseId: query.warehouseId,
        from: query.from,
        to: query.to,
        sort: query.sort,
        dir: sortDir(query.dir, 'DESC'),
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/returns/:id',
  requireAdmin('RETURN_VIEW'),
  asyncHandler(async (req, res) => {
    const detail = getReturnAdmin(req.params.id);
    if (detail === null) {
      throw httpError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }
    res.json(detail);
  }),
);

// ---------------------------------------------------------------------------
// Warehouses, workload, inventory, analytics
// ---------------------------------------------------------------------------

adminRouter.get(
  '/warehouses',
  requireAdmin('WAREHOUSE_VIEW'),
  asyncHandler(async (_req, res) => {
    res.json(listWarehousesAdmin());
  }),
);

adminRouter.get(
  '/warehouse-users',
  requireAdmin('USER_MANAGE'),
  asyncHandler(async (req, res) => {
    const query = validate(adminWarehouseUsersQuerySchema, req.query);
    res.json(
      listWarehouseUsers({
        search: query.search,
        warehouseId: query.warehouseId,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/workload',
  requireAdmin('WAREHOUSE_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminWorkloadQuerySchema, req.query);
    res.json(
      warehouseWorkload({
        warehouseId: query.warehouseId,
        status: query.status,
        priority: query.priority,
        assignedTo: query.assignedTo,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/inventory',
  requireAdmin('INVENTORY_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminInventoryQuerySchema, req.query);
    res.json(
      listInventoryAdmin({ search: query.search, limit: query.limit, offset: query.offset }),
    );
  }),
);

adminRouter.get(
  '/inventory/movements',
  requireAdmin('INVENTORY_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminMovementsQuerySchema, req.query);
    res.json(
      listMovementsAdmin({
        warehouseId: query.warehouseId,
        productId: query.productId,
        reason: query.reason,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/analytics',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminAnalyticsQuerySchema, req.query);
    res.json(adminAnalytics(query.windowDays, query.warehouseId));
  }),
);

// ---------------------------------------------------------------------------
// Settings (policy parameters; rule structure stays in code + tests)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/settings',
  requireAdmin('SETTINGS_MANAGE'),
  asyncHandler(async (_req, res) => {
    res.json({ settings: getSettingsState() });
  }),
);

adminRouter.patch(
  '/settings/:key',
  requireAdmin('SETTINGS_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminSettingBodySchema, req.body);
    res.json({
      setting: setSetting(
        { actorId: req.user?.id ?? '', ip: req.ip ?? null },
        req.params.key,
        body.value,
      ),
    });
  }),
);

// ---------------------------------------------------------------------------
// Return reasons
// ---------------------------------------------------------------------------

adminRouter.get(
  '/return-reasons',
  requireAdmin('SETTINGS_MANAGE'),
  asyncHandler(async (_req, res) => {
    res.json(listReasonsAdmin());
  }),
);

adminRouter.post(
  '/return-reasons',
  requireAdmin('SETTINGS_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminReasonBodySchema, req.body);
    const created = createReason(
      { id: req.user?.id ?? '', ip: req.ip ?? null },
      { code: body.code, label: body.label, description: body.description, sortOrder: body.sortOrder },
    );
    res.status(201).json({ reason: created });
  }),
);

adminRouter.patch(
  '/return-reasons/:code',
  requireAdmin('SETTINGS_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminReasonPatchSchema, req.body);
    res.json({
      reason: updateReason(
        { id: req.user?.id ?? '', ip: req.ip ?? null },
        req.params.code,
        { label: body.label, description: body.description, active: body.active, sortOrder: body.sortOrder },
      ),
    });
  }),
);

// ---------------------------------------------------------------------------
// Store credit (adjustments + visibility; payouts stay engine-owned)
// ---------------------------------------------------------------------------

adminRouter.post(
  '/credit/adjustments',
  requireAdmin('STORE_CREDIT_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminCreditAdjustSchema, req.body);
    const result = adjustCredit(
      { id: req.user?.id ?? '', ip: req.ip ?? null },
      {
        userId: body.userId,
        direction: body.direction,
        amountPaise: body.amountPaise,
        reason: body.reason,
        key: body.key,
      },
    );
    res.status(result.replayed ? 200 : 201).json(result);
  }),
);

adminRouter.get(
  '/credit/ledger',
  requireAdmin('STORE_CREDIT_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminLedgerQuerySchema, req.query);
    res.json(
      listLedgerAdmin({
        userId: query.userId,
        type: query.type,
        referenceType: query.referenceType,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/credit/balances',
  requireAdmin('STORE_CREDIT_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminLimitQuerySchema, req.query);
    res.json(listBalancesAdmin(query.limit));
  }),
);

// ---------------------------------------------------------------------------
// Refunds (read-only: transitions belong to the resolve engine)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/refunds',
  requireAdmin('REFUND_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminRefundsQuerySchema, req.query);
    res.json(
      listRefundsAdmin({
        search: query.search,
        status: query.status,
        kind: query.kind,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/refunds/:id',
  requireAdmin('REFUND_VIEW'),
  asyncHandler(async (req, res) => {
    const refund = getRefundAdmin(req.params.id);
    if (refund === null) {
      throw httpError(404, 'REFUND_NOT_FOUND', 'Refund not found');
    }
    res.json({ refund });
  }),
);

// ---------------------------------------------------------------------------
// Warehouses and operators (visibility + guarded lifecycle)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/warehouses/:id',
  requireAdmin('WAREHOUSE_VIEW'),
  asyncHandler(async (req, res) => {
    res.json(getWarehouseAdmin(req.params.id));
  }),
);

adminRouter.post(
  '/warehouses',
  requireAdmin('WAREHOUSE_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminWarehouseBodySchema, req.body);
    const created = createWarehouse(
      { id: req.user?.id ?? '', ip: req.ip ?? null },
      { code: body.code, name: body.name, city: body.city, active: body.active },
    );
    res.status(201).json({ warehouse: created });
  }),
);

adminRouter.patch(
  '/warehouses/:id',
  requireAdmin('WAREHOUSE_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminWarehousePatchSchema, req.body);
    res.json({
      warehouse: updateWarehouse(
        { id: req.user?.id ?? '', ip: req.ip ?? null },
        req.params.id,
        { name: body.name, city: body.city, active: body.active },
      ),
    });
  }),
);

adminRouter.post(
  '/warehouse-users',
  requireAdmin('USER_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminOperatorBodySchema, req.body);
    const created = createOperator(
      { id: req.user?.id ?? '', ip: req.ip ?? null },
      { email: body.email, password: body.password, fullName: body.fullName, warehouseId: body.warehouseId },
    );
    res.status(201).json({ user: created });
  }),
);

adminRouter.patch(
  '/warehouse-users/:id',
  requireAdmin('USER_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminOperatorPatchSchema, req.body);
    res.json({
      user: updateOperator(
        { id: req.user?.id ?? '', ip: req.ip ?? null },
        req.params.id,
        { warehouseId: body.warehouseId, active: body.active },
      ),
    });
  }),
);

// ---------------------------------------------------------------------------
// Admin users (self-lockout + last-admin guards live in the logic layer)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/users',
  requireAdmin('USER_MANAGE'),
  asyncHandler(async (req, res) => {
    const query = validate(adminUsersQuerySchema, req.query);
    res.json(
      listAdminUsers({
        search: query.search,
        role: query.role,
        active: query.active === undefined ? undefined : query.active === 'true',
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.post(
  '/users',
  requireAdmin('USER_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminUserBodySchema, req.body);
    const created = createAdminUser(
      { id: req.user?.id ?? '', ip: req.ip ?? null },
      { email: body.email, password: body.password, fullName: body.fullName },
    );
    res.status(201).json({ user: created });
  }),
);

adminRouter.patch(
  '/users/:id',
  requireAdmin('USER_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminUserPatchSchema, req.body);
    res.json({
      user: updateAdminUser(
        { id: req.user?.id ?? '', ip: req.ip ?? null },
        req.params.id,
        { fullName: body.fullName, active: body.active, role: body.role },
      ),
    });
  }),
);

// ---------------------------------------------------------------------------
// Customer account status (ban-safe by design: no transaction blockers)
// ---------------------------------------------------------------------------

adminRouter.patch(
  '/customers/:id',
  requireAdmin('CUSTOMER_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminCustomerPatchSchema, req.body);
    res.json({
      user: setCustomerActive({ id: req.user?.id ?? '', ip: req.ip ?? null }, req.params.id, body.active),
    });
  }),
);

// ---------------------------------------------------------------------------
// Support tickets (global visibility, assignment, replies)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/support/tickets',
  requireAdmin('SUPPORT_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminTicketsQuerySchema, req.query);
    res.json(
      listTicketsAdmin({
        search: query.search,
        status: query.status,
        priority: query.priority,
        assignedTo: query.assignedTo,
        customerId: query.customerId,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/support/tickets/:id',
  requireAdmin('SUPPORT_VIEW'),
  asyncHandler(async (req, res) => {
    const detail = getTicketAdmin(req.params.id);
    if (detail === null) {
      throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
    }
    res.json(detail);
  }),
);

adminRouter.patch(
  '/support/tickets/:id',
  requireAdmin('SUPPORT_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminTicketUpdateSchema, req.body);
    let ticket = getTicketAdmin(req.params.id);
    if (ticket === null) {
      throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
    }
    const actor = { id: req.user?.id ?? '', ip: req.ip ?? null };
    if (body.assignedTo !== undefined) {
      ticket = { ticket: assignTicket(actor, req.params.id, body.assignedTo), messages: ticket.messages };
    }
    if (body.status !== undefined) {
      ticket = { ticket: setTicketStatus(actor, req.params.id, body.status), messages: ticket.messages };
    }
    if (body.priority !== undefined) {
      ticket = { ticket: setTicketPriority(actor, req.params.id, body.priority), messages: ticket.messages };
    }
    res.json(ticket);
  }),
);

adminRouter.post(
  '/support/tickets/:id/messages',
  requireAdmin('SUPPORT_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminTicketReplySchema, req.body);
    const message = replyTicket({ id: req.user?.id ?? '', ip: req.ip ?? null }, req.params.id, body.body);
    res.status(201).json({ message });
  }),
);

// ---------------------------------------------------------------------------
// Notifications (inspect activity, manage templates)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/notifications',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminNotificationsQuerySchema, req.query);
    res.json(
      listNotificationsAdmin({
        search: query.search,
        type: query.type,
        userId: query.userId,
        unreadOnly: query.unreadOnly,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/notifications/templates',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (_req, res) => {
    res.json(listTemplatesAdmin());
  }),
);

adminRouter.put(
  '/notifications/templates/:key',
  requireAdmin('SETTINGS_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminTemplateBodySchema, req.body);
    res.json({
      template: upsertTemplate(
        { id: req.user?.id ?? '', ip: req.ip ?? null },
        req.params.key,
        { title: body.title, body: body.body, active: body.active },
      ),
    });
  }),
);

// ---------------------------------------------------------------------------
// Reports (CSV exports over the same authorized readers)
// ---------------------------------------------------------------------------

function csvAttachment(res: { setHeader: (name: string, value: string) => void }, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

adminRouter.get(
  '/reports/orders.csv',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminReportQuerySchema, req.query);
    csvAttachment(res, `orders-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(ordersReport({ search: query.search, status: query.status, limit: query.limit }));
  }),
);

adminRouter.get(
  '/reports/returns.csv',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminReportQuerySchema, req.query);
    csvAttachment(res, `returns-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(
      returnsReport({ search: query.search, status: query.status, resolution: query.resolution, limit: query.limit }),
    );
  }),
);

adminRouter.get(
  '/reports/refunds.csv',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminReportQuerySchema, req.query);
    csvAttachment(res, `refunds-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(
      refundsReport({ search: query.search, status: query.status, kind: query.kind, limit: query.limit }),
    );
  }),
);

adminRouter.get(
  '/reports/credit.csv',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminReportQuerySchema, req.query);
    csvAttachment(res, `credit-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(creditReport({ userId: query.userId, type: query.type, limit: query.limit }));
  }),
);

adminRouter.get(
  '/reports/inventory.csv',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminReportQuerySchema, req.query);
    csvAttachment(res, `inventory-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(inventoryReport({ search: query.search, limit: query.limit }));
  }),
);

adminRouter.get(
  '/reports/movements.csv',
  requireAdmin('ANALYTICS_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminReportQuerySchema, req.query);
    csvAttachment(res, `movements-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(
      movementsReport({
        warehouseId: query.warehouseId,
        productId: query.productId,
        reason: query.reason,
        limit: query.limit,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

adminRouter.get(
  '/categories',
  requireAdmin('PRODUCT_VIEW'),
  asyncHandler(async (_req, res) => {
    res.json(listCategoriesAdmin());
  }),
);

adminRouter.get(
  '/categories/:id',
  requireAdmin('PRODUCT_VIEW'),
  asyncHandler(async (req, res) => {
    res.json(getCategoryAdmin(req.params.id));
  }),
);

adminRouter.post(
  '/categories',
  requireAdmin('PRODUCT_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminCategoryBodySchema, req.body);
    const created = createCategory(
      { id: req.user?.id ?? '', ip: req.ip ?? null },
      { name: body.name, description: body.description, sortOrder: body.sortOrder, active: body.active },
    );
    res.status(201).json({ category: created });
  }),
);

adminRouter.patch(
  '/categories/:id',
  requireAdmin('PRODUCT_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminCategoryPatchSchema, req.body);
    res.json({
      category: updateCategory(
        { id: req.user?.id ?? '', ip: req.ip ?? null },
        req.params.id,
        { name: body.name, description: body.description, sortOrder: body.sortOrder, active: body.active },
      ),
    });
  }),
);

adminRouter.delete(
  '/categories/:id',
  requireAdmin('PRODUCT_MANAGE'),
  asyncHandler(async (req, res) => {
    deleteCategory({ id: req.user?.id ?? '', ip: req.ip ?? null }, req.params.id);
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

adminRouter.get(
  '/products',
  requireAdmin('PRODUCT_VIEW'),
  asyncHandler(async (req, res) => {
    const query = validate(adminProductsQuerySchema, req.query);
    res.json(
      listProductsAdmin({
        search: query.search,
        active: query.active === undefined ? undefined : query.active === 'true',
        categoryId: query.categoryId,
        sort: query.sort,
        dir: sortDir(query.dir),
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

adminRouter.get(
  '/products/:id',
  requireAdmin('PRODUCT_VIEW'),
  asyncHandler(async (req, res) => {
    res.json(getProductAdmin(req.params.id));
  }),
);

adminRouter.post(
  '/products',
  requireAdmin('PRODUCT_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminProductBodySchema, req.body);
    const created = createProduct(
      { id: req.user?.id ?? '', ip: req.ip ?? null },
      {
        sku: body.sku,
        name: body.name,
        description: body.description,
        details: body.details,
        pricePaise: body.pricePaise,
        imageUrl: body.imageUrl,
        stock: body.stock,
        categoryId: body.categoryId,
        active: body.active,
      },
    );
    res.status(201).json({ product: created });
  }),
);

adminRouter.patch(
  '/products/:id',
  requireAdmin('PRODUCT_MANAGE'),
  asyncHandler(async (req, res) => {
    const body = validate(adminProductPatchSchema, req.body);
    res.json({
      product: updateProduct(
        { id: req.user?.id ?? '', ip: req.ip ?? null },
        req.params.id,
        {
          name: body.name,
          description: body.description,
          details: body.details,
          imageUrl: body.imageUrl,
          pricePaise: body.pricePaise,
          stock: body.stock,
          categoryId: body.categoryId,
          active: body.active,
        },
      ),
    });
  }),
);
