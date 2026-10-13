/**
 * Правило «граница объекта обязательна».
 *
 * Самосвалы относят смену к объекту ТОЛЬКО по зоне с тегом dt_boundary
 * (dump-trucks/server/src/services/vehicleDetector.ts). Объект с зонами погрузки/выгрузки,
 * но без границы, виден в списке, а данных по нему нет (так было с Куртамышем, 2026-10).
 *
 * Поэтому:
 *  - новый объект создаётся сразу с границей (POST /api/geo/objects с boundary);
 *  - зоны погрузки/выгрузки/работы по месту нельзя добавить объекту без границы;
 *  - последнюю границу нельзя удалить или снять с неё тег, пока у объекта есть такие зоны.
 */
import { getPool } from './config/database';

const DT_WORK_TAGS = ['dt_loading', 'dt_unloading', 'dt_onsite'];

export class RuleError extends Error {}

interface ObjectDtStats { boundaries: number; workZones: number }

async function statsByObjectUid(objectUid: string): Promise<ObjectDtStats | null> {
  const { rows } = await getPool().query<{ found: boolean; boundaries: number; work_zones: number }>(`
    SELECT
      EXISTS (SELECT 1 FROM geo.objects WHERE uid = $1) AS found,
      COUNT(DISTINCT z.id) FILTER (WHERE zt.tag = 'dt_boundary')::int AS boundaries,
      COUNT(DISTINCT z.id) FILTER (WHERE zt.tag = ANY($2))::int AS work_zones
    FROM geo.objects o
    JOIN geo.zones z ON z.object_id = o.id
    JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE o.uid = $1
  `, [objectUid, DT_WORK_TAGS]);
  const r = rows[0];
  return r?.found ? { boundaries: r.boundaries, workZones: r.work_zones } : null;
}

async function zoneContext(zoneUid: string): Promise<{ objectUid: string; tags: string[] } | null> {
  const { rows } = await getPool().query<{ object_uid: string; tags: string[] }>(`
    SELECT o.uid AS object_uid,
           COALESCE(array_agg(zt.tag) FILTER (WHERE zt.tag IS NOT NULL), '{}') AS tags
    FROM geo.zones z
    JOIN geo.objects o ON o.id = z.object_id
    LEFT JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE z.uid = $1
    GROUP BY o.uid
  `, [zoneUid]);
  return rows[0] ? { objectUid: rows[0].object_uid, tags: rows[0].tags } : null;
}

const NO_BOUNDARY_MSG =
  'У объекта нет границы. Сначала нарисуйте зону «Граница объекта» (тип «Граница объекта (самосвалы)»), ' +
  'охватывающую всю территорию работ: без неё самосвалы на этом объекте не считаются.';

/** Перед созданием зоны. */
export async function assertCanCreateZone(objectUid: string, tags: string[]): Promise<void> {
  if (tags.includes('dt_boundary') || !tags.some(t => DT_WORK_TAGS.includes(t))) return;
  const st = await statsByObjectUid(objectUid);
  if (st && st.boundaries === 0) throw new RuleError(NO_BOUNDARY_MSG);
}

/** Перед правкой тегов (newTags) или удалением (newTags = null) зоны. */
export async function assertCanChangeZone(zoneUid: string, newTags: string[] | null): Promise<void> {
  const ctx = await zoneContext(zoneUid);
  if (!ctx) return;
  // Добавляют рабочий тег зоне объекта без границы — то же правило, что при создании.
  if (newTags && !ctx.tags.includes('dt_boundary')) {
    await assertCanCreateZone(ctx.objectUid, newTags);
    return;
  }
  const losesBoundary = ctx.tags.includes('dt_boundary') && (newTags === null || !newTags.includes('dt_boundary'));
  if (!losesBoundary) return;
  const st = await statsByObjectUid(ctx.objectUid);
  if (!st || st.boundaries > 1) return;
  // Сама зона может нести и рабочий тег — её рабочие теги тоже уходят вместе с удалением.
  const ownWork = ctx.tags.some(t => DT_WORK_TAGS.includes(t)) ? 1 : 0;
  const remainingWork = newTags === null ? st.workZones - ownWork : st.workZones - ownWork + (newTags.some(t => DT_WORK_TAGS.includes(t)) ? 1 : 0);
  if (remainingWork > 0) {
    throw new RuleError(
      'Это единственная граница объекта, а у него есть зоны погрузки/выгрузки. ' +
      'Удалить её нельзя — иначе самосвалы перестанут считаться. Перерисуйте границу (кнопка «Перерисовать») вместо удаления.',
    );
  }
}
