CREATE TABLE IF NOT EXISTS dump_trucks.order_norms (
  request_number  INTEGER PRIMARY KEY,
  trips_per_shift INTEGER NOT NULL,
  updated_at      TIMESTAMP DEFAULT NOW()
);
