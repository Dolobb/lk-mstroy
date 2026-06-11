/**
 * KIP Segment Daily Job — авто-выгрузка 30-минутных сегментов за вчера.
 *
 * Раньше сегменты (kip_shift_segments) качались только вручную из UI
 * (POST /api/segments/fetch и /fetch-all). Cron'а не было → полные данные
 * существовали лишь за несколько дат. Этот джоб закрывает дыру: каждый день
 * после основного dailyFetchJob он выбирает все реально работавшие пары
 * (vehicle_id, shift_type) за вчера и ставит их в существующую очередь
 * segmentProgress, у которой сегменты ещё не выгружены.
 *
 * Выборка: vehicle_records за дату с engine_on_time > 0 (нет смысла качать
 *   24 окна для ТС, которая стояла всю смену — там везде нули).
 * Фильтр:  пропускаем пары, у которых сегменты уже есть (hasSegments).
 * Конкурентность: на время джоба поднимаем setMaxConcurrent до
 *   SEGMENT_JOB_CONCURRENCY (дефолт 8) — разные ТС идут параллельно разными
 *   токенами без блокировок TIS (лимит per (token, idMO)). Узкое место — HTTP.
 * Расписание: node-cron 09:30 Asia/Yekaterinburg (после dailyFetch 08:30).
 */

import { getPool } from '../config/database';
import { hasSegments } from '../repositories/segmentRepo';
import { enqueue, setMaxConcurrent } from './segmentProgress';
import { logger } from '../utils/logger';

/** Дефолтная конкурентность джоба (разные ТС параллельно). */
const DEFAULT_CONCURRENCY = 8;

/**
 * Вчерашняя дата по Asia/Yekaterinburg (UTC+5), формат YYYY-MM-DD.
 * Считаем независимо от таймзоны сервера: берём текущий момент UTC,
 * сдвигаем на +5ч (получаем "сейчас" в Екатеринбурге), вычитаем сутки.
 */
function yesterdayYekaterinburg(): string {
  const YEKAT_OFFSET_MS = 5 * 60 * 60 * 1000;
  const nowYekat = new Date(Date.now() + YEKAT_OFFSET_MS);
  const yest = new Date(nowYekat.getTime() - 24 * 60 * 60 * 1000);
  // Берём календарную дату из UTC-полей сдвинутого момента
  const y = yest.getUTCFullYear();
  const m = String(yest.getUTCMonth() + 1).padStart(2, '0');
  const d = String(yest.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveConcurrency(): number {
  const raw = process.env['SEGMENT_JOB_CONCURRENCY'];
  if (raw && !isNaN(parseInt(raw, 10))) {
    return Math.max(1, parseInt(raw, 10));
  }
  return DEFAULT_CONCURRENCY;
}

export interface SegmentDailyResult {
  date: string;
  candidates: number; // пар (vehicle_id, shift) с engine_on_time > 0
  enqueued: number;   // поставлено в очередь
  skipped: number;    // уже есть сегменты
  dryRun: boolean;
  concurrency: number;
}

/**
 * Поставить в очередь выгрузку сегментов за дату (по умолчанию — вчера по
 * Asia/Yekaterinburg). Тонкая обёртка над segmentProgress.enqueue.
 *
 * @param dateStr  YYYY-MM-DD; если не задано — вчера по Екатеринбургу.
 * @param dryRun   если true — только посчитать кандидатов, ничего не enqueue
 *                 и не менять конкурентность (для смоук-теста).
 */
export async function runSegmentDailyJob(
  dateStr?: string,
  dryRun = false,
): Promise<SegmentDailyResult> {
  const date = dateStr ?? yesterdayYekaterinburg();
  const concurrency = resolveConcurrency();
  const pool = getPool();

  logger.info(`[SegmentDaily] Started for ${date} (dryRun=${dryRun}, concurrency=${concurrency})`);

  // 1. Реально работавшие пары (vehicle_id, shift_type) за дату.
  //    engine_on_time > 0 — отсекаем простоявшие ТС (там 24 нулевых окна).
  //    report_date <= CURRENT_DATE — на всякий случай не трогаем будущее.
  const result = await pool.query<{ vehicle_id: string; shift_type: string }>(
    `SELECT DISTINCT vehicle_id, shift_type
       FROM vehicle_records
      WHERE report_date = $1
        AND report_date <= CURRENT_DATE
        AND engine_on_time > 0
      ORDER BY vehicle_id, shift_type`,
    [date],
  );

  const candidates = result.rows.length;
  if (candidates === 0) {
    logger.info(`[SegmentDaily] No working vehicles (engine_on_time>0) for ${date}`);
    return { date, candidates: 0, enqueued: 0, skipped: 0, dryRun, concurrency };
  }

  // 2. Поднимаем конкурентность очереди на время джоба (только не в dry-run).
  //    setMaxConcurrent не сбрасывает ручной режим обратно — он остаётся
  //    повышенным до следующего вызова; ручные /fetch-all это устраивает
  //    (они лишь дольше «параллелятся»), а segmentFetchJob выставляет дефолт
  //    config.fetchConcurrency только однажды при инициализации TisClient.
  if (!dryRun) {
    setMaxConcurrent(concurrency);
  }

  // 3. Фильтруем уже выгруженные и enqueue остальное.
  let enqueued = 0;
  let skipped = 0;
  for (const row of result.rows) {
    const exists = await hasSegments(pool, row.vehicle_id, date, row.shift_type);
    if (exists) {
      skipped++;
      continue;
    }
    if (!dryRun) {
      enqueue(row.vehicle_id, date, row.shift_type);
    }
    enqueued++;
  }

  logger.info(
    `[SegmentDaily] ${date}: candidates=${candidates}, enqueued=${enqueued}, skipped=${skipped}` +
    (dryRun ? ' (dry-run, nothing enqueued)' : ''),
  );

  return { date, candidates, enqueued, skipped, dryRun, concurrency };
}
