-- Migrate is_broken from BOOLEAN to TEXT to support 3-phase repair status:
-- 'false' = ok, 'middle' = needs repair (требует ремонта), 'true' = broken (неисправен)
ALTER TABLE vehicle_status.vehicles
  ALTER COLUMN is_broken TYPE TEXT
  USING CASE WHEN is_broken THEN 'true' ELSE 'false' END;

ALTER TABLE vehicle_status.snapshots
  ALTER COLUMN is_broken TYPE TEXT
  USING CASE WHEN is_broken THEN 'true' ELSE 'false' END;
