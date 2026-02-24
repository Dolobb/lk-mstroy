# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

КИП техники (KIP Vehicles) — vehicle KPI monitoring system for construction fleet management. Fetches route lists, requests, and GPS/monitoring data from the TIS Online API, calculates KPIs (load efficiency, utilization), and displays results on a map + table dashboard.

## Commands

```bash
# Development (local, no Docker)
npm run dev:server        # Express + tsx watch on :3001 (serves API + client build)
npm run dev:client        # React dev server on :3000 (hot-reload for development)

# Development (Docker)
npm run dev               # docker-compose up (db + server + client)

# Build
npm run build             # Build both workspaces
npm run build --workspace=client  # Build client only (for production serving)

# Type-check (no eslint/prettier configured)
npm run lint              # tsc --noEmit for both workspaces

# Tests (jest configured but no tests written yet)
npm run test

# Database migration
npm run migrate --workspace=server   # ts-node src/migrate.ts

# Manual data fetch
curl -X POST "http://localhost:3001/api/admin/fetch?date=2026-02-10"

# PostgreSQL access
/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles
```

## Architecture

**Monorepo** with npm workspaces: `client/` (React 18 + Tailwind v4 + Leaflet, built with Vite) and `server/` (Express + PostgreSQL).

**Single-port serving**: Express serves React build (`client/dist`) + API on :3001.

### Data Pipeline (`server/src/jobs/dailyFetchJob.ts`)

Runs daily at 07:30 Asia/Yekaterinburg via node-cron:

1. Fetch route lists from TIS API (7 days back) → save to `route_lists` + `pl_calcs` + `vehicles`
2. Filter vehicles by keywords in `config/vehicle-types.json`
3. Split each vehicle's PL period into shifts (morning 07:30–19:30, evening 19:30–07:30)
4. Interleave monitoring requests round-robin across vehicles (rate limit: 1 req/30s per idMO)
5. Fetch requests from TIS API (2 months back) → save to `requests`
6. For each vehicle-shift: fetch monitoring → analyze geozones → get fuelNorm from registry → calculate KPIs → upsert `vehicle_records`

### TIS API Integration (`server/src/services/tisClient.ts`)

**Critical**: All requests are `POST` with **empty body**, all parameters in **query string**:

```
POST {baseUrl}?token=...&format=json&command={commandName}&{params}
```

Three commands: `getRequests`, `getRouteListsByDateOut`, `getMonitoringStats`. Responses use `{ list: [...] }` format. Dates are `DD.MM.YYYY` except `getMonitoringStats` which uses `DD.MM.YYYY HH:mm`. See `API_REQUEST_EXAMPLES.md` for full reference.

Token pool with round-robin rotation (18 tokens in `TIS_API_TOKENS`, comma-separated).

### Database (PostgreSQL 16, `kip_vehicles`)

5 tables: `vehicle_records` (KPIs for UI, PK: `report_date, shift_type, vehicle_id`), `route_lists`, `pl_calcs`, `vehicles`, `requests`. All use upsert logic. See `референсы и работа с агентом/DatabaseStructure.md` for full schema.

**Gotcha**: PostgreSQL NUMERIC columns return as strings in JS — always wrap with `Number()` before arithmetic (`coerceNumericFields` in `vehicleRecordRepo.ts`).

### Vehicle Registry (`server/src/services/vehicleRegistry.ts`)

`config/vehicle-registry.json` — ~170 vehicles with `regNumber`, `type`, `branch`, `fuelNorm`. Used for API response enrichment (type/branch fields), fuel norms, and in-memory filtering.

### Matching Logic

Request ↔ Route List: `request.number` matches number extracted from `pl.calcs[].orderDescr` via regex (`extractRequestNumber` in `plParser.ts`). Also `pl_calcs.id_order` for direct linking.

### Geozones (`server/src/services/geozoneAnalyzer.ts`)

Uses `config/geozones.geojson` (exported from fleetradar). Filters zones by `controlType === 1`. Point-in-polygon via Turf.js. Coordinates are GeoJSON `[longitude, latitude]`. Fallback when no zones match: `total_stay_time = engineOnTime`.

### Client

React 18 + Tailwind CSS v4 + Vite. CSS Grid layout: 2 columns (65%/35%), 2 rows.
- **Top-left**: FilterPanel (period, shift, cascading multi-select: branch/type/department)
- **Top-right**: Average KIP display + KPI range filter buttons (4 ranges)
- **Bottom-left**: VehicleMap (Leaflet, markers colored by utilization, tracks, geozone polygons)
- **Bottom-right**: DetailPanel (vehicle card + pivoted detail table + request navigator)
- Icons from `lucide-react`, utility `cn()` in `src/lib/utils.ts`

KPI color thresholds: RED <50%, BLUE 50–75%, GREEN >=75%.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/vehicles` | Legacy: single-date records |
| GET | `/api/vehicles/weekly` | Aggregated averages for map (main endpoint) |
| GET | `/api/vehicles/:id/details` | Per-vehicle day/shift details |
| GET | `/api/vehicles/:id/requests` | Requests linked to vehicle |
| GET | `/api/filters` | Cascading filter options |
| GET | `/api/geozones` | GeoJSON for map layer |
| POST | `/api/admin/fetch` | Manual pipeline trigger (async) |

## Environment

Copy `.env.example` to `.env` and fill in `TIS_API_URL` and `TIS_API_TOKENS`. Database defaults: `localhost:5432/kip_vehicles`.

## Key Config Files

- `config/vehicle-registry.json` — **primary**: ~170 vehicles with type, branch, fuelNorm
- `config/geozones.geojson` — work site polygons from fleetradar
- `config/vehicle-types.json` — vehicle filtering keywords for pipeline
- `config/shifts.json` — shift time boundaries (morning/evening)
- `config/fuel-norms.json` — legacy fuel norms (superseded by vehicle-registry)

## Full Documentation

- `референсы и работа с агентом/Architecture.md` — complete architecture reference
- `референсы и работа с агентом/DatabaseStructure.md` — DB schema, SQL queries, admin guide
- `API_REQUEST_EXAMPLES.md` — TIS API reference with curl/Node.js examples
