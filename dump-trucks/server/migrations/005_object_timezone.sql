ALTER TABLE dump_trucks.shift_records ADD COLUMN IF NOT EXISTS object_timezone TEXT NOT NULL DEFAULT 'Asia/Yekaterinburg';
