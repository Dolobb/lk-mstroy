# AGENTS.md — ЛК Мстрой

Compact guidance for OpenCode sessions. For full onboarding see `ONBOARDING_AGENT.md`.

## Start Here

**Documentation-first.** Always. Read order: `NAVIGATION.md` → `<service>/docs/HISTORY.md` → `<service>/docs/DEVGUIDE.md` → source code.

Every subproject has its own `CLAUDE.md` with service-specific gotchas — read it before editing that service.

## Dev Commands

```bash
npm run dev                              # Root: starts admin(:3005) + frontend(:5173); admin auto-launches all backends
cd frontend && npm run dev               # Frontend only
cd kip && npm run dev:server             # KIP :3001
cd dump-trucks/server && npm run dev      # Dump trucks :3002
cd geo-admin/server && npm run dev       # Geo admin :3003
cd vehicle-status/server && npm run dev  # Vehicle status :3004
cd ai-reports/server && npm run dev      # AI reports :3006
cd tyagachi && python main.py --web --port 8000  # Python/FastAPI
```

**Typecheck / lint:** `npm run lint` in each subproject (runs `tsc --noEmit`). No ESLint/Prettier configured. No test suites exist.

## Architecture

Monorepo with 7 services. Admin (`:3005`) is a process manager that starts the 5 Node backends on boot.

**Vite proxy** (`frontend/vite.config.ts`): `/api/kip→:3001` `/api/tyagachi→:8000` `/api/dt→:3002` `/api/vs→:3004` `/api/admin→:3005` `/api/reports→:3006`. Note: `/api/kip` and `/api/tyagachi` strip their prefix on rewrite.

**Frontend structure:** `frontend/src/features/<section>/` — each section is isolated. Routes defined in `src/App.tsx`.

## Critical Facts

### TIS API (external data source — all backends use it)
- **POST with empty body**, all params in query string: `POST {url}?token=...&format=json&command={cmd}&{params}`
- Rate limit: **1 req / 30s per idMO**; 18 tokens rotated round-robin
- `getMonitoringStats` dates: `DD.MM.YYYY HH:mm`; all others: `DD.MM.YYYY`

### Databases
- **Windows:** both PG16 and PG17 databases are on **port 5432** (single instance). Mac docs say 5432/5433 — ignore on Windows.
- **PG16** DB `kip_vehicles`: KIP data (5 tables). NUMERIC columns return as strings — wrap with `Number()`.
- **PG17** DB `mstroy`: 3 schemas — `dump_trucks`, `vehicle_status`, `geo`.
- **SQLite** `tyagachi/archive.db`: tyagachi data.
- **DB user = `max`** (not `postgres`!) for all PG17 connections.

### Shifts (universal across all services)
`shift1` (morning) = 07:30–19:30, `shift2` (evening) = 19:30–07:30+1. Timezone: Asia/Yekaterinburg (UTC+5).

### Secrets — NEVER commit
- All `.env` files in subproject roots
- `vehicle-status/server/creds.json` (Google Service Account)
- `TIS_API_TOKENS` — 18 comma-separated tokens

## Service-Specific Gotchas

- **dump-trucks:** `geo.objects` field is `smu` — NOT `smu_name`. TripBuilder: each unloading zone used once per shift (duplicate visits lost). ObjectDetector: object = max GPS points in `dt_boundary`.
- **vehicle-status:** `isBroken("требует ремонта")` → **false** (machine works, scheduled maintenance). Uses Drive API (not Sheets API) — Sheets API 400s on `.xlsx`. `creds.json` must not be committed.
- **kip:** KIP served as single-port (Express serves React build + API on :3001). Fallback when no zones match: `total_stay_time = engineOnTime`.
- **tyagachi:** `html_generator_v2.py` is ~4600-line monolith — changing one function can break another. `SUCCESSFULLY_COMPLETED` → `stable` → data NOT overwritten on sync. Claim periods precede PL periods by 1-3 months.
- **ai-reports:** **FROZEN** (demo mode). Do not modify without explicit instruction. `tsc --noEmit` OOMs on AI SDK v6 types — use `NODE_OPTIONS="--max-old-space-size=8192"` or skip typecheck for this service.
- **geo-admin:** Vanilla TypeScript client (NOT React). PostGIS: `ST_AsGeoJSON()` / `ST_GeomFromGeoJSON()`. Geometry editing only via direct API PUT, not UI.

## Git Rules

- Every task gets its own branch: `agent/glm/<type>-<description>` (types: `fix/`, `feat/`, `refactor/`, `docs/`)
- **Never** commit to `main`, never `--force`/`--hard`/`--no-verify`, never push without approval
- Commit messages: `<type>(<scope>): <description>` in English
- Stage specific files only (`git add <file>`), never `git add .` or `git add -A`
- Check `git diff` before every commit for secrets/leaked files

## Prohibited Without Approval

- `DROP TABLE`, `DELETE FROM` without WHERE, `TRUNCATE`
- Modifying `.env`, schema migrations (`npm run migrate`), cron schedules
- Adding dependencies, changing `package.json`/`requirements.txt`
- Changing API endpoints, Vite proxy, formulas (KIP, trips, norms)
- Creating new files, altering DB schema

## Manual Pipeline Triggers

```bash
curl -X POST "http://localhost:3001/api/admin/fetch?date=2026-04-13"                      # KIP
curl -X POST "http://localhost:3002/api/dt/admin/fetch?date=2026-04-13&shift=shift1"      # Dump trucks
curl -X POST "http://localhost:3004/api/vs/sync"                                           # Vehicle status
```
