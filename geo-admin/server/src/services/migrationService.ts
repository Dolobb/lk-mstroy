/**
 * Разовый скрипт импорта kip/config/geozones.geojson → geo.objects + geo.zones
 * Запуск: npm run migrate-geo
 * Или: POST /api/geo/admin/migrate-from-files
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { slugify } from '../utils/slugify';
import { logger } from '../utils/logger';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const GEOZONES_PATH = path.resolve(
  __dirname,
  '../../../../kip/config/geozones.geojson',
);

interface GeoZoneFeature {
  type: 'Feature';
  properties: {
    zoneName: string;
    uid: string;
    controlType: number;
    region?: string;
    [key: string]: unknown;
  };
  geometry: GeoJSON.Polygon;
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoZoneFeature[];
}

/**
 * findOrCreate geo.object по uid (slug из имени объекта).
 * Возвращает id объекта.
 */
async function findOrCreateObject(
  pool: Pool,
  uid: string,
  name: string,
  smu: string | null,
  region: string | null,
): Promise<number> {
  const existing = await pool.query<{ id: number }>(
    'SELECT id FROM geo.objects WHERE uid = $1',
    [uid],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const { rows } = await pool.query<{ id: number }>(`
    INSERT INTO geo.objects (uid, name, smu, region)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [uid, name, smu, region]);

  return rows[0].id;
}

export async function migrateFromFiles(): Promise<{
  zones_imported: number;
  objects_created: number;
  skipped: number;
}> {
  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME     || 'mstroy',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  try {
    if (!fs.existsSync(GEOZONES_PATH)) {
      throw new Error(`geozones.geojson not found at: ${GEOZONES_PATH}`);
    }

    const raw = fs.readFileSync(GEOZONES_PATH, 'utf8');
    const geojson = JSON.parse(raw) as FeatureCollection;

    // Фильтр: только controlType === 1
    const features = geojson.features.filter(
      f => f.properties.controlType === 1,
    );
    logger.info(`migrateFromFiles: ${features.length} features with controlType=1`);

    let zones_imported = 0;
    let objects_created_count = 0;
    let skipped = 0;

    // Считаем объекты до старта
    const { rows: beforeRows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM geo.objects',
    );
    const objectsBefore = Number(beforeRows[0].count);

    for (const feature of features) {
      const { zoneName, uid: zoneUid, region } = feature.properties;

      // Разбить по первой запятой+пробел
      const commaIdx = zoneName.indexOf(', ');
      let smu: string | null;
      let objectName: string;

      if (commaIdx !== -1) {
        smu        = zoneName.slice(0, commaIdx).trim();
        objectName = zoneName.slice(commaIdx + 2).trim();
      } else {
        smu        = null;
        objectName = zoneName.trim();
      }

      // uid объекта — slug из имени объекта (не из uid зоны)
      const objectUid = slugify(objectName).slice(0, 50) || slugify(zoneName).slice(0, 50);

      try {
        const objectId = await findOrCreateObject(
          pool,
          objectUid,
          objectName,
          smu,
          region || null,
        );

        // Вставить зону (idempotent)
        const { rows: zoneRows } = await pool.query<{ id: number }>(`
          INSERT INTO geo.zones (uid, object_id, name, geom)
          VALUES ($1, $2, $3, ST_GeomFromGeoJSON($4))
          ON CONFLICT (uid) DO NOTHING
          RETURNING id
        `, [
          zoneUid,
          objectId,
          zoneName,
          JSON.stringify(feature.geometry),
        ]);

        if (zoneRows.length > 0) {
          const zoneId = zoneRows[0].id;
          // Тег dst_zone для КИП
          await pool.query(`
            INSERT INTO geo.zone_tags (zone_id, tag)
            VALUES ($1, 'dst_zone')
            ON CONFLICT DO NOTHING
          `, [zoneId]);
          zones_imported++;
        } else {
          skipped++;
        }
      } catch (err) {
        logger.warn(`Skipping zone ${zoneUid}: ${(err as Error).message}`);
        skipped++;
      }
    }

    const { rows: afterRows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM geo.objects',
    );
    objects_created_count = Number(afterRows[0].count) - objectsBefore;

    logger.info(
      `Migration complete: ${zones_imported} zones imported, ` +
      `${objects_created_count} objects created, ${skipped} skipped`,
    );

    return { zones_imported, objects_created: objects_created_count, skipped };
  } finally {
    await pool.end();
  }
}

// CLI запуск: tsx src/services/migrationService.ts
if (require.main === module) {
  migrateFromFiles()
    .then(result => {
      console.log('Result:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
