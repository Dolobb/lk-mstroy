import { Pool } from 'pg';
import type { TrackPoint } from './dwellExtractor';

export async function computeVisitedObjectsForPoints(
  pool: Pool,
  points: { lat: number; lng: number }[],
): Promise<string[]> {
  if (points.length === 0) return [];

  const sampled = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (i % 10 === 0) sampled.push(points[i]);
  }
  if (points.length > 1) sampled.push(points[points.length - 1]);

  const params: unknown[] = [];
  const conditions: string[] = [];
  for (let i = 0; i < sampled.length; i++) {
    const p = sampled[i];
    params.push(p.lng, p.lat);
    conditions.push(
      `ST_Contains(z.geom, ST_SetSRID(ST_MakePoint($${i * 2 + 1}, $${i * 2 + 2}), 4326))`,
    );
  }

  const res = await pool.query<{ uid: string }>(
    `SELECT DISTINCT o.uid
     FROM geo.objects o
     JOIN geo.zones z ON z.object_id = o.id
     WHERE (${conditions.join(' OR ')})
     LIMIT 100`,
    params,
  );

  return res.rows.map(r => r.uid);
}
