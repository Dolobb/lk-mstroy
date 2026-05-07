-- KIP-7: Add object_timezone column to vehicle_records
ALTER TABLE vehicle_records
  ADD COLUMN IF NOT EXISTS object_timezone TEXT;
