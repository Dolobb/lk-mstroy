-- Заявки на транспорт (из getRequests)
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL UNIQUE,       -- id из API
  number INTEGER NOT NULL,                   -- номер заявки (ключ для matching)
  status VARCHAR(30),
  date_create TIMESTAMP,
  date_processed TIMESTAMP,
  contact_person VARCHAR(200),
  raw_json JSONB,                            -- полный ответ для orders/route
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_requests_number ON requests(number);

-- Путевые листы (из getRouteListsByDateOut)
CREATE TABLE IF NOT EXISTS route_lists (
  id SERIAL PRIMARY KEY,
  pl_id BIGINT NOT NULL,                     -- id из API
  ts_number BIGINT,
  ts_type VARCHAR(30),
  date_out DATE,
  date_out_plan TIMESTAMP,
  date_in_plan TIMESTAMP,
  status VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (pl_id)
);

CREATE INDEX idx_route_lists_date ON route_lists(date_out);

-- Задания из путевого листа (calcs[])
CREATE TABLE IF NOT EXISTS pl_calcs (
  id SERIAL PRIMARY KEY,
  route_list_id INTEGER NOT NULL REFERENCES route_lists(id) ON DELETE CASCADE,
  order_descr TEXT,
  extracted_request_number INTEGER,          -- regex из orderDescr
  object_expend VARCHAR(50),
  driver_task TEXT
);

CREATE INDEX idx_pl_calcs_request ON pl_calcs(extracted_request_number);

-- ТС из путевого листа (ts[])
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  route_list_id INTEGER NOT NULL REFERENCES route_lists(id) ON DELETE CASCADE,
  id_mo INTEGER NOT NULL,                    -- idMO для getMonitoringStats
  reg_number VARCHAR(20) NOT NULL,
  name_mo VARCHAR(200),
  category VARCHAR(10),
  garage_number VARCHAR(30)
);

CREATE INDEX idx_vehicles_reg ON vehicles(reg_number);
CREATE INDEX idx_vehicles_idmo ON vehicles(id_mo);

-- Расчётные данные КИП/нагрузки по сменам
CREATE TABLE IF NOT EXISTS vehicle_records (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  shift_type VARCHAR(20) NOT NULL,           -- morning / evening
  vehicle_id VARCHAR(20) NOT NULL,           -- reg_number
  vehicle_model VARCHAR(200) NOT NULL,
  company_name VARCHAR(200) NOT NULL,
  department_unit VARCHAR(200) NOT NULL,
  total_stay_time NUMERIC(8,4) NOT NULL,     -- часы (из геозон)
  engine_on_time NUMERIC(8,4) NOT NULL,      -- часы (engineTime / 3600)
  idle_time NUMERIC(8,4) NOT NULL,           -- total_stay_time - engine_on_time
  fuel_consumed_total NUMERIC(10,4) NOT NULL,-- sum(fuels[].rate)
  fuel_rate_fact NUMERIC(10,4) NOT NULL,
  max_work_allowed NUMERIC(8,4) NOT NULL,
  fuel_rate_norm NUMERIC(10,4) NOT NULL,
  fuel_max_calc NUMERIC(10,4) NOT NULL,
  fuel_variance NUMERIC(10,4) NOT NULL,
  load_efficiency_pct NUMERIC(6,2) NOT NULL,
  utilization_ratio NUMERIC(6,2) NOT NULL,
  latitude NUMERIC(10,7),                    -- последняя точка track[]
  longitude NUMERIC(10,7),
  track_simplified JSONB,                    -- упрощённый трек для отображения
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (report_date, shift_type, vehicle_id)
);

CREATE INDEX idx_vehicle_records_date ON vehicle_records(report_date);
CREATE INDEX idx_vehicle_records_vehicle ON vehicle_records(vehicle_id);
CREATE INDEX idx_vehicle_records_company ON vehicle_records(company_name);
CREATE INDEX idx_vehicle_records_department ON vehicle_records(department_unit);
