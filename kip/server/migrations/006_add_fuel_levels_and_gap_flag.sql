-- KIP-3: Add fuel level columns and gap-filled flag to vehicle_records
ALTER TABLE vehicle_records
  ADD COLUMN IF NOT EXISTS fuel_value_begin NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS fuel_value_end NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS is_gap_filled BOOLEAN DEFAULT false;
