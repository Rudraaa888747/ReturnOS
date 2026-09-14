-- ReturnOS Phase 3: operational execution layer for finalized dispositions.
-- Additive only; Phase-1 and Phase-2 tables are untouched.

-- ============ DISPOSITION EXECUTIONS ============
CREATE TABLE disposition_executions (
    id UUID PRIMARY KEY,
    return_id UUID NOT NULL UNIQUE REFERENCES returns(id) ON DELETE CASCADE,
    disposition VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    assignee_id UUID REFERENCES app_users(id),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_seconds BIGINT,
    failure_reason VARCHAR(1000),
    notes VARCHAR(2000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_execution_disposition CHECK (disposition IN (
        'RESTOCK', 'REFURBISH', 'RESELL', 'RETURN_TO_VENDOR', 'LIQUIDATE', 'RECYCLE', 'SCRAP'
    )),
    CONSTRAINT chk_execution_status CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'))
);
CREATE INDEX idx_executions_return ON disposition_executions(return_id);
CREATE INDEX idx_executions_status ON disposition_executions(status);

-- ============ INVENTORY RECOVERIES (RESTOCK) ============
CREATE TABLE inventory_recoveries (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL UNIQUE REFERENCES disposition_executions(id) ON DELETE CASCADE,
    return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    recovered_quantity INT NOT NULL,
    destination VARCHAR(255) NOT NULL,
    action VARCHAR(16) NOT NULL,
    recorded_by UUID REFERENCES app_users(id),
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_inventory_quantity CHECK (quantity > 0),
    CONSTRAINT chk_inventory_recovered CHECK (recovered_quantity >= 0),
    CONSTRAINT chk_inventory_action CHECK (action IN ('RESTOCKED'))
);
CREATE INDEX idx_inventory_execution ON inventory_recoveries(execution_id);
CREATE INDEX idx_inventory_return ON inventory_recoveries(return_id);

-- ============ VENDOR CLAIMS ============
CREATE TABLE vendor_claims (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL UNIQUE REFERENCES disposition_executions(id) ON DELETE CASCADE,
    return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    reason VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    vendor_reference VARCHAR(255),
    expected_credit NUMERIC(12, 2),
    actual_credit NUMERIC(12, 2),
    notes VARCHAR(2000),
    created_by UUID REFERENCES app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP WITH TIME ZONE,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    decided_at TIMESTAMP WITH TIME ZONE,
    settled_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_vendor_quantity CHECK (quantity > 0),
    CONSTRAINT chk_vendor_status CHECK (status IN (
        'DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'APPROVED', 'REJECTED', 'SETTLED'
    ))
);
CREATE INDEX idx_vendor_execution ON vendor_claims(execution_id);
CREATE INDEX idx_vendor_return ON vendor_claims(return_id);
CREATE INDEX idx_vendor_status ON vendor_claims(status);

-- ============ RECOVERY RECORDS (RESELL / LIQUIDATE) ============
CREATE TABLE recovery_records (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL UNIQUE REFERENCES disposition_executions(id) ON DELETE CASCADE,
    return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    disposition VARCHAR(32) NOT NULL,
    channel VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL,
    listed_value NUMERIC(12, 2),
    expected_recovery NUMERIC(12, 2) NOT NULL DEFAULT 0,
    actual_recovered NUMERIC(12, 2),
    fees NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_recovered NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notes VARCHAR(2000),
    recorded_by UUID REFERENCES app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    listed_at TIMESTAMP WITH TIME ZONE,
    sold_at TIMESTAMP WITH TIME ZONE,
    settled_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_recovery_disposition CHECK (disposition IN ('RESELL', 'LIQUIDATE')),
    CONSTRAINT chk_recovery_status CHECK (status IN ('PENDING', 'LISTED', 'SOLD', 'SETTLED', 'FAILED'))
);
CREATE INDEX idx_recovery_execution ON recovery_records(execution_id);
CREATE INDEX idx_recovery_return ON recovery_records(return_id);

-- ============ DISPOSAL RECORDS (RECYCLE / SCRAP) ============
CREATE TABLE disposal_records (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL UNIQUE REFERENCES disposition_executions(id) ON DELETE CASCADE,
    return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    disposition VARCHAR(32) NOT NULL,
    quantity INT NOT NULL,
    partner VARCHAR(255),
    estimated_recovery NUMERIC(12, 2) NOT NULL DEFAULT 0,
    actual_recovery NUMERIC(12, 2),
    processing_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes VARCHAR(2000),
    completed_by UUID REFERENCES app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_disposal_disposition CHECK (disposition IN ('RECYCLE', 'SCRAP')),
    CONSTRAINT chk_disposal_quantity CHECK (quantity > 0)
);
CREATE INDEX idx_disposal_execution ON disposal_records(execution_id);
CREATE INDEX idx_disposal_return ON disposal_records(return_id);

-- ============ OPERATIONAL TASKS ============
CREATE TABLE operational_tasks (
    id UUID PRIMARY KEY,
    return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    execution_id UUID REFERENCES disposition_executions(id) ON DELETE CASCADE,
    task_type VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    assignee_id UUID REFERENCES app_users(id),
    created_by UUID REFERENCES app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes VARCHAR(2000),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_task_type CHECK (task_type IN (
        'INSPECT_RETURN', 'RESTOCK_ITEM', 'REFURBISH_ITEM', 'SUBMIT_VENDOR_CLAIM',
        'SEND_TO_LIQUIDATION', 'PROCESS_RECYCLING', 'SCRAP_ITEM'
    )),
    CONSTRAINT chk_task_status CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT chk_task_priority CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH'))
);
CREATE INDEX idx_tasks_return ON operational_tasks(return_id);
CREATE INDEX idx_tasks_execution ON operational_tasks(execution_id);
CREATE INDEX idx_tasks_assignee ON operational_tasks(assignee_id);
CREATE INDEX idx_tasks_status ON operational_tasks(status);
