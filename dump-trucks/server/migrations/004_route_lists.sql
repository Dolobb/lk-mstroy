-- Персистентное хранение путевых листов из TIS
-- Решает: утечку заявок между датами + потерю длинных ПЛ

CREATE TABLE IF NOT EXISTS dump_trucks.route_lists (
  id              INTEGER PRIMARY KEY,           -- pl.id из TIS
  ts_number       INTEGER,
  date_out        DATE,
  date_out_plan   TIMESTAMP NOT NULL,
  date_in_plan    TIMESTAMP NOT NULL,
  status          VARCHAR(50) NOT NULL,
  vehicle_ids     INTEGER[] NOT NULL DEFAULT '{}',   -- ВСЕ idMO из pl.ts[] (без фильтрации типа)
  request_numbers INTEGER[] NOT NULL DEFAULT '{}',   -- из calcs[].orderDescr
  object_expends  TEXT[] NOT NULL DEFAULT '{}',       -- из calcs[].objectExpend
  raw_json        JSONB,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rl_date_range ON dump_trucks.route_lists (date_out_plan, date_in_plan);
CREATE INDEX IF NOT EXISTS idx_rl_vehicle_ids ON dump_trucks.route_lists USING GIN (vehicle_ids);
CREATE INDEX IF NOT EXISTS idx_rl_status ON dump_trucks.route_lists (status);
