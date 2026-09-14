-- ReturnOS Phase 1 baseline schema
-- Compatible with PostgreSQL and H2 (PostgreSQL mode) for tests.

-- ============ USERS ============
CREATE TABLE app_users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_app_users_role CHECK (role IN ('CUSTOMER', 'WAREHOUSE_STAFF', 'ADMIN'))
);
CREATE UNIQUE INDEX uq_app_users_email ON app_users(email);

-- ============ PRODUCTS ============
CREATE TABLE products (
    id UUID PRIMARY KEY,
    sku VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(128) NOT NULL,
    description VARCHAR(2000),
    price NUMERIC(12, 2) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_products_price CHECK (price >= 0)
);
CREATE UNIQUE INDEX uq_products_sku ON products(sku);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_active ON products(active);

-- ============ ORDERS ============
CREATE TABLE customer_orders (
    id UUID PRIMARY KEY,
    order_number VARCHAR(64) NOT NULL,
    customer_id UUID NOT NULL REFERENCES app_users(id),
    status VARCHAR(32) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_customer_orders_status CHECK (status IN ('PLACED', 'DELIVERED', 'CANCELLED'))
);
CREATE UNIQUE INDEX uq_customer_orders_number ON customer_orders(order_number);
CREATE INDEX idx_customer_orders_customer ON customer_orders(customer_id);
CREATE INDEX idx_customer_orders_status ON customer_orders(status);

CREATE TABLE order_items (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    line_total NUMERIC(12, 2) NOT NULL,
    CONSTRAINT chk_order_items_qty CHECK (quantity > 0),
    CONSTRAINT chk_order_items_unit_price CHECK (unit_price >= 0)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- ============ RETURNS ============
CREATE TABLE returns (
    id UUID PRIMARY KEY,
    return_number VARCHAR(64) NOT NULL,
    order_id UUID NOT NULL REFERENCES customer_orders(id),
    customer_id UUID NOT NULL REFERENCES app_users(id),
    status VARCHAR(32) NOT NULL,
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by UUID REFERENCES app_users(id),
    rejected_at TIMESTAMP WITH TIME ZONE,
    rejected_by UUID REFERENCES app_users(id),
    rejection_reason VARCHAR(1000),
    received_at TIMESTAMP WITH TIME ZONE,
    received_by UUID REFERENCES app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_returns_status CHECK (status IN (
        'REQUESTED', 'APPROVED', 'REJECTED',
        'IN_TRANSIT', 'RECEIVED',
        'INSPECTION_PENDING', 'INSPECTION_IN_PROGRESS', 'INSPECTION_COMPLETED'
    ))
);
CREATE UNIQUE INDEX uq_returns_number ON returns(return_number);
CREATE INDEX idx_returns_order ON returns(order_id);
CREATE INDEX idx_returns_customer ON returns(customer_id);
CREATE INDEX idx_returns_status ON returns(status);

CREATE TABLE return_items (
    id UUID PRIMARY KEY,
    return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id),
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    reason VARCHAR(32) NOT NULL,
    description VARCHAR(1000),
    CONSTRAINT chk_return_items_qty CHECK (quantity > 0),
    CONSTRAINT chk_return_items_reason CHECK (reason IN (
        'DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'WRONG_SIZE',
        'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'MISSING_PARTS', 'OTHER'
    ))
);
CREATE INDEX idx_return_items_return ON return_items(return_id);
CREATE INDEX idx_return_items_product ON return_items(product_id);

-- ============ INSPECTIONS ============
CREATE TABLE inspections (
    id UUID PRIMARY KEY,
    return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    physical_condition VARCHAR(32) NOT NULL,
    packaging_condition VARCHAR(32) NOT NULL,
    accessories_complete BOOLEAN NOT NULL,
    functional_test_result VARCHAR(32) NOT NULL,
    visible_damage VARCHAR(1000),
    notes VARCHAR(2000),
    inspected_by UUID REFERENCES app_users(id),
    inspected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_inspection_physical CHECK (physical_condition IN ('EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED')),
    CONSTRAINT chk_inspection_packaging CHECK (packaging_condition IN ('SEALED', 'OPENED', 'DAMAGED', 'MISSING')),
    CONSTRAINT chk_inspection_functional CHECK (functional_test_result IN ('PASSED', 'FAILED', 'NOT_TESTED'))
);
CREATE UNIQUE INDEX uq_inspections_return ON inspections(return_id);

-- ============ AUDIT LOGS ============
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    performed_by VARCHAR(255),
    reason VARCHAR(1000),
    metadata VARCHAR(2000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
