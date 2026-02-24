import { getPool } from '../config/database';
import { uniqueObjectUid } from '../utils/slugify';

export interface GeoObject {
  id: number;
  uid: string;
  name: string;
  smu: string | null;
  region: string | null;
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

export async function getAllObjects(): Promise<GeoObjectWithCount[]> {
  const pool = getPool();
  const { rows } = await pool.query<GeoObjectWithCount>(`
    SELECT
      o.id, o.uid, o.name, o.smu, o.region, o.created_at, o.updated_at,
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
    'SELECT id, uid, name, smu, region, created_at, updated_at FROM geo.objects WHERE uid = $1',
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
  smu?: string;
  region?: string;
}): Promise<GeoObject> {
  const pool = getPool();
  const uid = await uniqueObjectUid(pool, data.name);

  const { rows } = await pool.query<GeoObject>(`
    INSERT INTO geo.objects (uid, name, smu, region)
    VALUES ($1, $2, $3, $4)
    RETURNING id, uid, name, smu, region, created_at, updated_at
  `, [uid, data.name, data.smu ?? null, data.region ?? null]);

  return rows[0];
}

export async function updateObject(
  uid: string,
  data: { name?: string; smu?: string | null; region?: string | null },
): Promise<GeoObject | null> {
  const pool = getPool();

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);
  }
  if (data.smu !== undefined) {
    fields.push(`smu = $${idx++}`);
    values.push(data.smu);
  }
  if (data.region !== undefined) {
    fields.push(`region = $${idx++}`);
    values.push(data.region);
  }
  if (fields.length === 0) return getObjectRow(uid);

  fields.push(`updated_at = NOW()`);
  values.push(uid);

  const { rows } = await pool.query<GeoObject>(`
    UPDATE geo.objects SET ${fields.join(', ')}
    WHERE uid = $${idx}
    RETURNING id, uid, name, smu, region, created_at, updated_at
  `, values);

  return rows[0] ?? null;
}

async function getObjectRow(uid: string): Promise<GeoObject | null> {
  const pool = getPool();
  const { rows } = await pool.query<GeoObject>(
    'SELECT id, uid, name, smu, region, created_at, updated_at FROM geo.objects WHERE uid = $1',
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
