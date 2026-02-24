-- Migration 002: repairs table
-- Таблица ремонтов и ТО для машин (заполняется вручную)

CREATE TABLE IF NOT EXISTS dump_trucks.repairs (
  id          SERIAL PRIMARY KEY,
  reg_number  VARCHAR(50) NOT NULL,
  name_mo     VARCHAR(500),
  type        VARCHAR(20) DEFAULT 'repair' CHECK (type IN ('repair', 'maintenance')),
  reason      VARCHAR(500),
  date_from   DATE NOT NULL,
  date_to     DATE,
  object_name VARCHAR(500),
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repairs_reg_number ON dump_trucks.repairs (reg_number);
CREATE INDEX IF NOT EXISTS idx_repairs_date ON dump_trucks.repairs (date_from, date_to);
