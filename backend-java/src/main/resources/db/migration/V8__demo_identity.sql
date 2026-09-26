-- Backfill for databases migrated before the demo identity was generalized:
-- rename any legacy personal demo account to the public demo customer.
-- Matched by email (never by id: user ids are referenced by foreign keys).
-- On fresh databases V7 already seeds the public identity, so these are
-- no-ops there. Idempotent.
UPDATE users SET email='customer@returnos.test',
  password_hash='$2a$10$zeN0N1f5ONonZMsvucUkFOsvtm3JNN2Us66QF0Nf7hSuRK2oAbGne',
  full_name='Demo Customer'
WHERE email='rudrachokshi441@gmail.com';

UPDATE addresses SET full_name='Demo Customer'
WHERE user_id=(SELECT id FROM users WHERE email='customer@returnos.test')
  AND full_name='Rudra Chokshi';
