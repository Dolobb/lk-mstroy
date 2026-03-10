-- Migration 003: Время в пути для рейсов
-- travel_to_unload_min: от выхода из зоны погрузки до входа в зону выгрузки
-- return_to_load_min:   от выхода из зоны выгрузки до входа в следующую зону погрузки

ALTER TABLE dump_trucks.trips
  ADD COLUMN IF NOT EXISTS travel_to_unload_min INTEGER,
  ADD COLUMN IF NOT EXISTS return_to_load_min INTEGER;
