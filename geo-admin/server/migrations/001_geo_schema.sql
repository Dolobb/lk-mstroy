CREATE SCHEMA IF NOT EXISTS geo;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS geo.objects (
  id         SERIAL PRIMARY KEY,
  uid        VARCHAR(50) UNIQUE NOT NULL,
  name       VARCHAR(200) NOT NULL,
  smu        VARCHAR(200),
  region     VARCHAR(200),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geo.zones (
  id         SERIAL PRIMARY KEY,
  uid        VARCHAR(50) UNIQUE NOT NULL,
  object_id  INTEGER NOT NULL REFERENCES geo.objects(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  geom       GEOMETRY(Polygon, 4326) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zones_geom_idx ON geo.zones USING GIST (geom);

CREATE TABLE IF NOT EXISTS geo.zone_tags (
  zone_id INTEGER NOT NULL REFERENCES geo.zones(id) ON DELETE CASCADE,
  tag     VARCHAR(30) NOT NULL,
  PRIMARY KEY (zone_id, tag)
);

CREATE TABLE IF NOT EXISTS geo._migrations (
  name       VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT NOW()
);
