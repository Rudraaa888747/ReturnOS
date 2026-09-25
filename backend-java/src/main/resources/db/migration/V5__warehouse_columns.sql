ALTER TABLE pickups ADD COLUMN received_at timestamptz;
ALTER TABLE pickups ADD COLUMN expected_arrival text;
ALTER TABLE warehouse_tasks ADD COLUMN sla_breached_at timestamptz;
