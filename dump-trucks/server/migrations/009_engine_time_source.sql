-- 009: engine_time_source — origin of engine_time_sec
-- 'sensor' = engineTime from TIS (CAN-bus); 'geo' = derived from GPS track range
-- when sensor is silent (=0) but vehicle was active in dt_* zones.

ALTER TABLE dump_trucks.shift_records
  ADD COLUMN IF NOT EXISTS engine_time_source VARCHAR(10) NOT NULL DEFAULT 'sensor'
    CHECK (engine_time_source IN ('sensor','geo'));
