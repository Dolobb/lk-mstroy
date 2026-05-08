import { getPool } from '../config/database';
import { uniqueObjectUid } from '../utils/slugify';

export interface GeoObject {
  id: number;
  uid: string;
  name: string;
  timezone: string;
  min_trips_per_shift: number;
  created_at: Date;
  updated_at: Date;
}

export interface GeoObjectWithCount extends GeoObject {
  zone_count: number;
}

export interface ObjectWithZones {
  object: GeoObject;
  zones: GeoJSON.FeatureCollection;
}

const OBJECT_COLUMNS = `
  o.id, o.uid, o.name, o.timezone, o.min_trips_per_shift,
  o.created_at, o.updated_at
`;

export async function getAllObjects(): Promise<GeoObjectWithCount[]> {
  const pool = getPool();
  const { rows } = await pool.query<GeoObjectWithCount>(`
    SELECT
      ${OBJECT_COLUMNS},
      COUNT(DISTINCT z.id)::int AS zone_count
    FROM geo.objects o
    LEFT JOIN geo.zones z ON z.object_id = o.id
    GROUP BY o.id
    ORDER BY o.name
  `);
  return rows;
}

export async function getObjectByUid(uid: string): Promise<ObjectWithZones | null> {
  const pool = getPool();

  const { rows: objRows } = await pool.query<GeoObject>(
    `SELECT ${OBJECT_COLUMNS} FROM geo.objects o WHERE uid = $1`,
    [uid],
  );
  if (objRows.length === 0) return null;
  const object = objRows[0];

  const { rows: zoneRows } = await pool.query<{
    id: number; uid: string; name: string;
    geometry: string; tags: string[];
  }>(`
    SELECT
      z.id, z.uid, z.name,
      ST_AsGeoJSON(z.geom)::text AS geometry,
      COALESCE(array_agg(zt.tag) FILTER (WHERE zt.tag IS NOT NULL), '{}') AS tags
    FROM geo.zones z
    LEFT JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE z.object_id = $1
    GROUP BY z.id
    ORDER BY z.name
  `, [object.id]);

  const features: GeoJSON.Feature[] = zoneRows.map(z => ({
    type: 'Feature',
    properties: { uid: z.uid, name: z.name, tags: z.tags },
    geometry: JSON.parse(z.geometry) as GeoJSON.Geometry,
  }));

  return {
    object,
    zones: { type: 'FeatureCollection', features },
  };
}

export async function createObject(data: {
  name: string;
  timezone?: string;
  minTripsPerShift?: number;
}): Promise<GeoObject> {
  const pool = getPool();
  const uid = await uniqueObjectUid(pool, data.name);

  const { rows } = await pool.query<GeoObject>(`
    INSERT INTO geo.objects (uid, name, timezone, min_trips_per_shift)
    VALUES ($1, $2, $3, $4)
    RETURNING ${OBJECT_COLUMNS.replace(/\bo\./g, '')}
  `, [
    uid,
    data.name,
    data.timezone ?? 'Asia/Yekaterinburg',
    Number.isFinite(data.minTripsPerShift) ? Number(data.minTripsPerShift) : 0,
  ]);

  return rows[0];
}

export async function updateObject(
  uid: string,
  data: { name?: string; timezone?: string; minTripsPerShift?: number },
): Promise<GeoObject | null> {
  const pool = getPool();

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);
  }
  if (data.timezone !== undefined) {
    fields.push(`timezone = $${idx++}`);
    values.push(data.timezone);
  }
  if (data.minTripsPerShift !== undefined) {
    fields.push(`min_trips_per_shift = $${idx++}`);
    values.push(Number(data.minTripsPerShift));
  }
  if (fields.length === 0) return getObjectRow(uid);

  fields.push(`updated_at = NOW()`);
  values.push(uid);

  const { rows } = await pool.query<GeoObject>(`
    UPDATE geo.objects SET ${fields.join(', ')}
    WHERE uid = $${idx}
    RETURNING ${OBJECT_COLUMNS.replace(/\bo\./g, '')}
  `, values);

  return rows[0] ?? null;
}

async function getObjectRow(uid: string): Promise<GeoObject | null> {
  const pool = getPool();
  const { rows } = await pool.query<GeoObject>(
    `SELECT ${OBJECT_COLUMNS} FROM geo.objects o WHERE uid = $1`,
    [uid],
  );
  return rows[0] ?? null;
}

export async function deleteObject(uid: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'DELETE FROM geo.objects WHERE uid = $1',
    [uid],
  );
  return (rowCount ?? 0) > 0;
}
