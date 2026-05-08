import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { getEnvConfig } from './config/env';
import { logger } from './utils/logger';
import * as objectRepo from './repositories/objectRepo';
import * as zoneRepo from './repositories/zoneRepo';

const app = express();
app.use(cors());
app.use(express.json());

// ────────────────────────────────────────────
// Health
// ────────────────────────────────────────────
app.get('/api/geo/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', module: 'geo-admin' });
});

// ────────────────────────────────────────────
// Objects
// ────────────────────────────────────────────
app.get('/api/geo/objects', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const objects = await objectRepo.getAllObjects();
    res.json(objects);
  } catch (err) { next(err); }
});

app.get('/api/geo/objects/:uid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await objectRepo.getObjectByUid(req.params.uid);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) { next(err); }
});

app.post('/api/geo/objects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, timezone, minTripsPerShift } = req.body as {
      name?: string; timezone?: string; minTripsPerShift?: number;
    };
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    const obj = await objectRepo.createObject({ name, timezone, minTripsPerShift });
    res.status(201).json(obj);
  } catch (err) { next(err); }
});

app.put('/api/geo/objects/:uid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, timezone, minTripsPerShift } = req.body as {
      name?: string; timezone?: string; minTripsPerShift?: number;
    };
    const obj = await objectRepo.updateObject(req.params.uid, { name, timezone, minTripsPerShift });
    if (!obj) return res.status(404).json({ error: 'Not found' });
    res.json(obj);
  } catch (err) { next(err); }
});

app.delete('/api/geo/objects/:uid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await objectRepo.deleteObject(req.params.uid);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true, uid: req.params.uid });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────
// Zones — read endpoints (before :uid to avoid route collision)
// ────────────────────────────────────────────
app.get('/api/geo/zones/by-object/:objectUid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tagsParam = req.query.tags as string | undefined;
    const filterTags = tagsParam ? tagsParam.split(',').map(t => t.trim()) : undefined;
    const fc = await zoneRepo.getZonesByObject(req.params.objectUid, filterTags);
    res.json(fc);
  } catch (err) { next(err); }
});

app.get('/api/geo/zones/by-tag/:tag', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fc = await zoneRepo.getZonesByTag(req.params.tag);
    res.json(fc);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────
// Zone change webhook — notify admin for auto-cascade
// ────────────────────────────────────────────
async function notifyZoneChanged(zoneUid: string, objectUid: string | undefined, action: string, tags: string[]): Promise<void> {
  try {
    await fetch('http://localhost:3005/api/admin/zone-changed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneUid, objectUid, action, tags }),
    });
    logger.info(`[cascade] Notified admin: zone ${zoneUid} ${action}, tags=[${tags.join(',')}]`);
  } catch {
    // fire-and-forget: admin might not be running
  }
}

// ────────────────────────────────────────────
// Zones — CRUD
// ────────────────────────────────────────────
app.post('/api/geo/zones', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { objectUid, name, tags, geometry, minDurationSec } = req.body as {
      objectUid?: string; name?: string; tags?: unknown; geometry?: unknown;
      minDurationSec?: number;
    };

    if (!objectUid) return res.status(400).json({ error: 'objectUid is required' });
    if (!name)      return res.status(400).json({ error: 'name is required' });
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
    if (!geometry || typeof geometry !== 'object') {
      return res.status(400).json({ error: 'geometry is required' });
    }

    const tagErr = zoneRepo.validateTags(tags as string[]);
    if (tagErr) return res.status(400).json({ error: tagErr });

    const zone = await zoneRepo.createZone({
      objectUid,
      name,
      tags: tags as string[],
      geometry: geometry as GeoJSON.Polygon,
      minDurationSec: minDurationSec != null ? Number(minDurationSec) : undefined,
    });
    res.status(201).json(zone);
    // Fire-and-forget webhook
    notifyZoneChanged(zone.uid, objectUid, 'create', tags as string[]);
  } catch (err) { next(err); }
});

app.put('/api/geo/zones/:uid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, tags, geometry, minDurationSec } = req.body as {
      name?: string; tags?: string[]; geometry?: GeoJSON.Polygon;
      minDurationSec?: number;
    };

    if (tags !== undefined) {
      if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
      const tagErr = zoneRepo.validateTags(tags);
      if (tagErr) return res.status(400).json({ error: tagErr });
    }

    const zone = await zoneRepo.updateZone(req.params.uid, {
      name, tags, geometry,
      minDurationSec: minDurationSec != null ? Number(minDurationSec) : undefined,
    });
    if (!zone) return res.status(404).json({ error: 'Not found' });
    res.json(zone);
    // Fire-and-forget webhook — use updated tags or existing ones
    notifyZoneChanged(req.params.uid, undefined, 'update', zone.tags ?? tags ?? []);
  } catch (err) { next(err); }
});

app.delete('/api/geo/zones/:uid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await zoneRepo.deleteZone(req.params.uid);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true, uid: req.params.uid });
    // Notify with all possible tags since the zone is already deleted
    notifyZoneChanged(req.params.uid, undefined, 'delete', ['dst_zone', 'dt_boundary', 'dt_loading', 'dt_unloading', 'dt_onsite']);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────
// Admin: trigger geojson migration
// ────────────────────────────────────────────
app.post('/api/geo/admin/migrate-from-files', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Import dynamically to avoid loading at startup
    const { migrateFromFiles } = await import('./services/migrationService');
    const result = await migrateFromFiles();
    res.json(result);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────
// Static: Admin UI
// JS comes from client/dist (compiled TS)
// HTML/CSS come from client/src (source assets)
// ────────────────────────────────────────────
const clientDist = path.join(__dirname, '../../client/dist');
const clientSrc  = path.join(__dirname, '../../client/src');
app.use('/admin', express.static(clientDist));
app.use('/admin', express.static(clientSrc));
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(clientSrc, 'index.html'));
});
app.get('/admin/', (_req, res) => {
  res.sendFile(path.join(clientSrc, 'index.html'));
});

// ────────────────────────────────────────────
// Error handler
// ────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: err.message });
});

// ────────────────────────────────────────────
// Start
// ────────────────────────────────────────────
const { serverPort } = getEnvConfig();
app.listen(serverPort, () => {
  logger.info(`geo-admin server running on :${serverPort}`);
  logger.info(`Admin UI: http://localhost:${serverPort}/admin`);
});
