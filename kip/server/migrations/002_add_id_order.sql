ALTER TABLE pl_calcs ADD COLUMN IF NOT EXISTS id_order INTEGER;
CREATE INDEX IF NOT EXISTS idx_pl_calcs_id_order ON pl_calcs(id_order);
