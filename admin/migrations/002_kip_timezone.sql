-- Add timezone column to vehicle_records in kip_vehicles DB
-- Run against kip_vehicles database (not mstroy!)

ALTER TABLE vehicle_records
  ADD COLUMN IF NOT EXISTS object_timezone VARCHAR(40) DEFAULT 'Asia/Yekaterinburg';
