import { Router } from 'express';
import { getPool } from '../db';
import { logger } from '../utils/logger';

export interface AnalyticsGroup {
  objectUid: string;
  vehicleIds: string[];
}

export interface GroupsResponse {
  from: string;
  to: string;
  objects: AnalyticsGroup[];
  outside: string[];
}

export interface BigObject {
  uid: string;
  name: string;
}

export async function getGroups(
  from: string,
  to: string,
): Promise<GroupsResponse> {
  const pool = getPool();

  // Object groups: vehicles that visited each object at least once
  const objectRes = await pool.query<{ vehicle_id: string; object_uid: string }>(
    `SELECT DISTINCT vehicle_id, unnest(visited_objects) AS object_uid
     FROM analytics.track_sessions
     WHERE date >= $1::date
       AND date <= $2::date
       AND cardinality(visited_objects) > 0`,
    [from, to],
  );

  const objectMap = new Map<string, Set<string>>();
  for (const r of objectRes.rows) {
    if (!objectMap.has(r.object_uid)) {
      objectMap.set(r.object_uid, new Set());
    }
    objectMap.get(r.object_uid)!.add(r.vehicle_id);
  }

  // Outside: vehicles with track data but no visited objects across the period
  const outsideRes = await pool.query<{ vehicle_id: string }>(
    `SELECT vehicle_id
     FROM analytics.track_sessions
     WHERE date >= $1::date
       AND date <= $2::date
     GROUP BY vehicle_id
     HAVING bool_and(cardinality(visited_objects) = 0)`,
    [from, to],
  );

  const objects: AnalyticsGroup[] = [];
  for (const [objectUid, vehicleSet] of objectMap) {
    objects.push({ objectUid, vehicleIds: [...vehicleSet] });
  }
  objects.sort((a, b) => a.objectUid.localeCompare(b.objectUid));

  return {
    from,
    to,
    objects,
    outside: outsideRes.rows.map(r => r.vehicle_id),
  };
}

export async function getBigObjects(): Promise<BigObject[]> {
  const pool = getPool();

  const res = await pool.query<{ uid: string; name: string }>(
    `SELECT o.uid, o.name
     FROM geo.objects o
     WHERE EXISTS (
       SELECT 1 FROM geo.zones z
       JOIN geo.zone_tags zt ON zt.zone_id = z.id
       WHERE z.object_id = o.id AND zt.tag = 'dt_boundary'
     )
     AND EXISTS (
       SELECT 1 FROM geo.zones z
       JOIN geo.zone_tags zt ON zt.zone_id = z.id
       WHERE z.object_id = o.id AND zt.tag IN ('dt_loading', 'dt_unloading', 'dt_onsite')
     )
     ORDER BY o.name`,
  );

  return res.rows;
}

export function groupsRouter(): Router {
  const router = Router();

  router.get('/analytics/groups', async (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    if (!from || !to) {
      res.status(400).json({ error: 'Query parameters "from" and "to" required (YYYY-MM-DD)' });
      return;
    }

    try {
      const groups = await getGroups(from, to);
      res.json(groups);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Groups endpoint failed', err);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/analytics/objects', async (_req, res) => {
    try {
      const objects = await getBigObjects();
      res.json({ objects });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Objects endpoint failed', err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
