import { readFile } from 'fs/promises';
import { closePool, getPool } from '../config/database';
import { createObject } from '../repositories/objectRepo';

const DEFAULT_GEOJSON_PATH = 'C:/lk-mstroy/export-111577946.geojson';
const DST_ZONE_TAG = 'dst_zone';
const DEFAULT_MIN_DURATION_SEC = 120;

type Position = [number, number, ...number[]];

interface TisZoneProperties {
  zoneName?: unknown;
  uid?: unknown;
  controlType?: unknown;
}

interface TisFeature {
  type: 'Feature';
  properties?: TisZoneProperties | null;
  geometry?: GeoJSON.Polygon | null;
}

interface TisFeatureCollection {
  type: 'FeatureCollection';
  features: TisFeature[];
}

interface ZoneToImport {
  uid: string;
  zoneName: string;
  timezone: string;
  centroidLon: number;
  geometry: GeoJSON.Polygon;
}

interface ImportSummary {
  workZones: number;
  alreadyExists: number;
  added: number;
  duplicateInDump: number;
  invalid: number;
}

// Долготный фоллбэк — груб для РФ (админ-tz не следуют долготе), используется
// только если по названию объекта регион определить не удалось.
function inferTimezoneByLon(lon: number): string {
  if (lon < 40) return 'Europe/Moscow';
  if (lon < 67) return 'Asia/Yekaterinburg';
  if (lon < 78) return 'Asia/Omsk';
  if (lon < 90) return 'Asia/Krasnoyarsk';
  if (lon < 105) return 'Asia/Irkutsk';
  if (lon < 120) return 'Asia/Yakutsk';
  return 'Asia/Vladivostok';
}

// Надёжный резолвер: по ключевым словам города/региона в названии зоны.
// РФ административные timezone не выводятся из долготы (Тюмень UTC+5 и Омск UTC+6
// на близких долготах), а название объекта содержит город — это точнее.
const CITY_TZ: Array<{ kw: RegExp; tz: string }> = [
  { kw: /москв|московск|тверь|тул[аы]|калуг|рязан|владимир|ярослав|смоленск|брянск|воронеж|липецк|курск|белгород|орёл|орел|иванов|костром|псков|новгород|санкт-петербург|спб|ленинградск|вологд|карели/i, tz: 'Europe/Moscow' },
  { kw: /тюмень|тюменск|тобольск|курган|куртамыш|акияры|качипова|ханты|хмао|сургут|пыть-ях|нижневартовск|нефтеюганск|когалым|ноябрьск|новый уренгой|ямал|салехард|надым|свердлов|екатеринбург|асбест|челябинск|магнитогорск|пермь|пермск|уфа|башкорт|оренбург|курганск/i, tz: 'Asia/Yekaterinburg' },
  { kw: /омск/i, tz: 'Asia/Omsk' },
  { kw: /новосибирск|томск|кемеров|барнаул|алтай|новокузнецк/i, tz: 'Asia/Novosibirsk' },
  { kw: /красноярск|норильск|абакан|хакас|кызыл|тыва/i, tz: 'Asia/Krasnoyarsk' },
  { kw: /иркутск|бодайбо|ангарск|братск|усть-кут|бурят|улан-удэ/i, tz: 'Asia/Irkutsk' },
  { kw: /якут|нерюнгри|мирный|ленск/i, tz: 'Asia/Yakutsk' },
  { kw: /приморск|владивосток|находк|осиновка|рудная пристань|уссурийск|артём|артем|хабаровск|комсомольск|амурск/i, tz: 'Asia/Vladivostok' },
];

function resolveTimezone(zoneName: string, lon: number): { tz: string; byName: boolean } {
  for (const { kw, tz } of CITY_TZ) {
    if (kw.test(zoneName)) return { tz, byName: true };
  }
  return { tz: inferTimezoneByLon(lon), byName: false };
}


function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
  );
}

function calculateCentroidLon(geometry: GeoJSON.Polygon): number {
  const outerRing = geometry.coordinates[0] as unknown[];
  const points = outerRing.filter(isPosition);

  if (points.length === 0) {
    throw new Error('Polygon outer ring has no valid coordinates');
  }

  const lonSum = points.reduce((sum, point) => sum + point[0], 0);
  return lonSum / points.length;
}

function isTisFeatureCollection(value: unknown): value is TisFeatureCollection {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'FeatureCollection'
    && Array.isArray((value as { features?: unknown }).features)
  );
}

function getCliOptions(): { geojsonPath: string; write: boolean } {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const geojsonPath = args.find(arg => arg !== '--write') ?? DEFAULT_GEOJSON_PATH;

  return { geojsonPath, write };
}

async function readDump(path: string): Promise<TisFeatureCollection> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!isTisFeatureCollection(parsed)) {
    throw new Error(`Invalid GeoJSON FeatureCollection: ${path}`);
  }

  return parsed;
}

async function loadExistingZoneUids(): Promise<Set<string>> {
  const pool = getPool();
  const { rows } = await pool.query<{ uid: string }>('SELECT uid FROM geo.zones');
  return new Set(rows.map(row => row.uid));
}

function collectMissingZones(collection: TisFeatureCollection, existingUids: Set<string>): {
  zones: ZoneToImport[];
  summary: ImportSummary;
} {
  const seenDumpUids = new Set<string>();
  const zones: ZoneToImport[] = [];
  const summary: ImportSummary = {
    workZones:       0,
    alreadyExists:  0,
    added:          0,
    duplicateInDump: 0,
    invalid:        0,
  };

  for (const feature of collection.features) {
    if (feature.properties?.controlType !== 1) continue;
    summary.workZones += 1;

    const uid = feature.properties.uid;
    const zoneName = feature.properties.zoneName;
    const geometry = feature.geometry;

    if (typeof uid !== 'string' || uid.trim() === ''
      || typeof zoneName !== 'string' || zoneName.trim() === ''
      || !geometry || geometry.type !== 'Polygon') {
      summary.invalid += 1;
      console.warn('[WARN] Пропущена work-зона с некорректными uid/zoneName/geometry');
      continue;
    }

    if (seenDumpUids.has(uid)) {
      summary.duplicateInDump += 1;
      console.warn(`[WARN] Дубликат uid в дампе, пропуск: ${uid} | ${zoneName}`);
      continue;
    }
    seenDumpUids.add(uid);

    if (existingUids.has(uid)) {
      summary.alreadyExists += 1;
      continue;
    }

    try {
      const centroidLon = calculateCentroidLon(geometry);
      const { tz: timezone, byName } = resolveTimezone(zoneName, centroidLon);
      if (!byName) {
        console.warn(
          `[WARN] tz не определён по названию, фоллбэк по долготе: ${uid} | ${zoneName} | lon=${centroidLon.toFixed(3)} | tz=${timezone} — сверить вручную`,
        );
      }

      zones.push({
        uid,
        zoneName,
        timezone,
        centroidLon,
        geometry,
      });
    } catch (err) {
      summary.invalid += 1;
      console.warn(`[WARN] Пропущена зона с некорректной геометрией: ${uid} | ${zoneName}`);
      if (err instanceof Error) {
        console.warn(`[WARN] ${err.message}`);
      }
    }
  }

  summary.added = zones.length;
  return { zones, summary };
}

async function insertZone(zone: ZoneToImport): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Объект создаётся через существующий репозиторий, чтобы сохранить локальные правила uid.
    const obj = await createObject({ name: zone.zoneName, timezone: zone.timezone });

    const { rows } = await client.query<{ id: number }>(`
      INSERT INTO geo.zones (uid, object_id, name, geom, min_duration_sec)
      VALUES ($1, $2, $3, ST_GeomFromGeoJSON($4), $5)
      RETURNING id
    `, [
      zone.uid,
      obj.id,
      zone.zoneName,
      JSON.stringify(zone.geometry),
      DEFAULT_MIN_DURATION_SEC,
    ]);

    const zoneId = rows[0].id;
    await client.query(
      'INSERT INTO geo.zone_tags (zone_id, tag) VALUES ($1, $2)',
      [zoneId, DST_ZONE_TAG],
    );

    await client.query('COMMIT');
    console.log(`[ADD] ${zone.uid} | ${zone.zoneName} | ${zone.timezone}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const { geojsonPath, write } = getCliOptions();

  console.log(`[MODE] ${write ? 'WRITE' : 'DRY-RUN'}`);
  console.log(`[FILE] ${geojsonPath}`);

  const dump = await readDump(geojsonPath);
  const existingUids = await loadExistingZoneUids();
  const { zones, summary } = collectMissingZones(dump, existingUids);

  if (!write) {
    for (const zone of zones) {
      // Dry-run печатает полный список того, что будет создано при --write.
      console.log(`[DRY-RUN] ${zone.uid} | ${zone.zoneName} | ${zone.timezone}`);
    }
  } else {
    for (const zone of zones) {
      await insertZone(zone);
    }
  }

  console.log('');
  console.log(`Work-зон в дампе: ${summary.workZones}`);
  console.log(`Уже было в БД: ${summary.alreadyExists}`);
  console.log(write ? `Добавлено: ${summary.added}` : `Было бы добавлено: ${summary.added}`);

  if (summary.duplicateInDump > 0) {
    console.log(`Дубликатов uid в дампе пропущено: ${summary.duplicateInDump}`);
  }
  if (summary.invalid > 0) {
    console.log(`Некорректных work-зон пропущено: ${summary.invalid}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error('[ERROR] importTisZones failed');
    if (err instanceof Error) {
      console.error(err.message);
      if (err.stack) console.error(err.stack);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
