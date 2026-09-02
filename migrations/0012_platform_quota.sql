-- Atomic platform storage ledger. CREATE is not idempotent. Do not re-apply this file.
CREATE TABLE platform_quota (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  used INTEGER NOT NULL
);
INSERT INTO platform_quota (id, used)
SELECT 1,
  (SELECT COALESCE(SUM(size), 0) FROM site_files) +
  (SELECT COALESCE(SUM(size), 0) FROM loose_files);
