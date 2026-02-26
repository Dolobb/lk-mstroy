import { nanoid } from 'nanoid';
import { getPool } from '../config/database';

export interface GeoZone {
  id: number;
  uid: string;
  object_id: number;
  name: string;
  tags: string[];
  geometry: GeoJSON.Polygon;
  created_at: Date;
  updated_at: Date;
}

const ALLOWED_TAGS = new Set([
  'dt_boundary', 'dt_loading', 'dt_unloading', 'dt_onsite', 'dst_zone',
]);

export function validateTags(tags: string[]): string | null {
  for (const tag of tags) {
    if (!ALLOWED_TAGS.has(tag)) {
      return `Unknown tag: "${tag}". Allowed: ${[...ALLOWED_TAGS].join(', ')}`;
    }
  }
  return null;
}

async function rowToZone(row: {
  id: number; uid: string; object_id: number; name: string;
  geometry: string; tags: string[]; created_at: Date; updated_at: Date;
}): Promise<GeoZone> {
  return {
    id:         row.id,
    uid:        row.uid,
    object_id:  row.object_id,
    name:       row.name,
    tags:       row.tags,
    geometry:   JSON.parse(row.geometry) as GeoJSON.Polygon,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getZonesByObject(
  objectUid: string,
  filterTags?: string[],
): Promise<GeoJSON.FeatureCollection> {
  const pool = getPool();

  let tagFilter = '';
  const params: unknown[] = [objectUid];

  if (filterTags && filterTags.length > 0) {
    params.push(filterTags);
    tagFilter = `AND zt.tag = ANY($2::text[])`;
  }

  const { rows } = await pool.query<{
    uid: string; name: string; geometry: string; tags: string[];
  }>(`
    SELECT
      z.uid, z.name,
      ST_AsGeoJSON(z.geom)::text AS geometry,
      COALESCE(array_agg(DISTINCT zt.tag) FILTER (WHERE zt.tag IS NOT NULL), '{}') AS tags
    FROM geo.zones z
    JOIN geo.objects o ON o.id = z.object_id
    LEFT JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE o.uid = $1
    ${tagFilter}
    GROUP BY z.id
    ORDER BY z.name
  `, params);

  return {
    type: 'FeatureCollection',
    features: rows.map(z => ({
      type: 'Feature',
      properties: { uid: z.uid, name: z.name, tags: z.tags },
      geometry: JSON.parse(z.geometry) as GeoJSON.Geometry,
    })),
  };
}

export async function getZonesByTag(tag: string): Promise<GeoJSON.FeatureCollection> {
  const pool = getPool();
  const { rows } = await pool.query<{
    uid: string; name: string; geometry: string; object_name: string;
    object_uid: string; tags: string[];
  }>(`
    SELECT
      z.uid, z.name,
      ST_AsGeoJSON(z.geom)::text AS geometry,
      o.name AS object_name,
      o.uid  AS object_uid,
      COALESCE(array_agg(DISTINCT zt2.tag) FILTER (WHERE zt2.tag IS NOT NULL), '{}') AS tags
    FROM geo.zones z
    JOIN geo.zone_tags zt  ON zt.zone_id  = z.id
    JOIN geo.objects   o   ON o.id        = z.object_id
    LEFT JOIN geo.zone_tags zt2 ON zt2.zone_id = z.id
    WHERE zt.tag = $1
    GROUP BY z.id, o.name, o.uid
    ORDER BY z.name
  `, [tag]);

  return {
    type: 'FeatureCollection',
    features: rows.map(z => ({
      type: 'Feature',
      properties: { uid: z.uid, name: z.name, object_name: z.object_name, object_uid: z.object_uid, tags: z.tags },
      geometry: JSON.parse(z.geometry) as GeoJSON.Geometry,
    })),
  };
}

export async function createZone(data: {
  objectUid: string;
  name: string;
  tags: string[];
  geometry: GeoJSON.Polygon;
}): Promise<GeoZone> {
  const pool = getPool();

  // Resolve object
  const { rows: objRows } = await pool.query<{ id: number }>(
    'SELECT id FROM geo.objects WHERE uid = $1',
    [data.objectUid],
  );
  if (objRows.length === 0) {
    throw new Error(`Object not found: ${data.objectUid}`);
  }
  const objectId = objRows[0].id;
  const uid = `zone_${nanoid(8)}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{
      id: number; uid: string; object_id: number; name: string;
      geometry: string; created_at: Date; updated_at: Date;
    }>(`
      INSERT INTO geo.zones (uid, object_id, name, geom)
      VALUES ($1, $2, $3, ST_GeomFromGeoJSON($4))
      RETURNING id, uid, object_id, name, ST_AsGeoJSON(geom)::text AS geometry, created_at, updated_at
    `, [uid, objectId, data.name, JSON.stringify(data.geometry)]);

    const zone = rows[0];

    for (const tag of data.tags) {
      await client.query(
        'INSERT INTO geo.zone_tags (zone_id, tag) VALUES ($1, $2)',
        [zone.id, tag],
      );
    }

    await client.query('COMMIT');

    return rowToZone({ ...zone, tags: data.tags });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateZone(
  uid: string,
  data: { name?: string; tags?: string[]; geometry?: GeoJSON.Polygon },
): Promise<GeoZone | null> {
  const pool = getPool();

  const { rows: zoneRows } = await pool.query<{ id: number }>(
    'SELECT id FROM geo.zones WHERE uid = $1',
    [uid],
  );
  if (zoneRows.length === 0) return null;
  const zoneId = zoneRows[0].id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (data.name !== undefined || data.geometry !== undefined) {
      const fields: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [];
      let idx = 1;

      if (data.name !== undefined) {
        fields.push(`name = $${idx++}`);
        values.push(data.name);
      }
      if (data.geometry !== undefined) {
        fields.push(`geom = ST_GeomFromGeoJSON($${idx++})`);
        values.push(JSON.stringify(data.geometry));
      }
      values.push(zoneId);

      await client.query(
        `UPDATE geo.zones SET ${fields.join(', ')} WHERE id = $${idx}`,
        values,
      );
    }

    if (data.tags !== undefined) {
      await client.query('DELETE FROM geo.zone_tags WHERE zone_id = $1', [zoneId]);
      for (const tag of data.tags) {
        await client.query(
          'INSERT INTO geo.zone_tags (zone_id, tag) VALUES ($1, $2)',
          [zoneId, tag],
        );
      }
    }

    await client.query('COMMIT');

    return getZoneByUid(uid);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteZone(uid: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'DELETE FROM geo.zones WHERE uid = $1',
    [uid],
  );
  return (rowCount ?? 0) > 0;
}

async function getZoneByUid(uid: string): Promise<GeoZone | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: number; uid: string; object_id: number; name: string;
    geometry: string; tags: string[]; created_at: Date; updated_at: Date;
  }>(`
    SELECT
      z.id, z.uid, z.object_id, z.name,
      ST_AsGeoJSON(z.geom)::text AS geometry,
      COALESCE(array_agg(zt.tag) FILTER (WHERE zt.tag IS NOT NULL), '{}') AS tags,
      z.created_at, z.updated_at
    FROM geo.zones z
    LEFT JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE z.uid = $1
    GROUP BY z.id
  `, [uid]);

  if (rows.length === 0) return null;
  return rowToZone(rows[0]);
}
