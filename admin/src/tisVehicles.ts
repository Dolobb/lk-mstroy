/**
 * «Добавить из TIS»: справочник техники TIS (getPassports) с отметками
 * «уже в ЛК» / «работала по ПЛ за 30 дней» и подсказкой типа по похожим машинам реестра.
 *
 * TIS-доступ — те же URL и токены, что у КИП (kip/.env). getPassports отдаёт весь парк
 * организации (~2200 ТС за ~2 с); кэшируем на час, кнопка «Обновить» сбрасывает кэш.
 */
import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { KIP_REGISTRY_PATH, dupKey, type KipVehicle } from './vehicles';

const KIP_ENV_PATH = path.resolve(__dirname, '../../kip/.env');
const CACHE_TTL_MS = 60 * 60 * 1000;

interface TisPassport {
  idMO: number;
  regNumber: string;
  modelOrMarkOrModif: string;
  garageNumber?: string;
  kindType?: string | null;
  registered?: boolean;
}

let cache: { at: number; passports: TisPassport[] } | null = null;

function readKipEnv(): { url: string; tokens: string[] } {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(KIP_ENV_PATH, 'utf-8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.trimStart().startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const tokens = (env.TIS_API_TOKENS || env.TIS_API_TOKEN || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!env.TIS_API_URL || tokens.length === 0) throw new Error('В kip/.env нет TIS_API_URL / TIS_API_TOKENS');
  return { url: env.TIS_API_URL, tokens };
}

async function fetchPassports(): Promise<TisPassport[]> {
  const { url, tokens } = readKipEnv();
  let lastErr: unknown = null;
  // Пустой ответ или ошибка на одном токене — пробуем следующие (до 3).
  for (const token of tokens.slice(0, 3)) {
    try {
      const res = await fetch(`${url}?token=${encodeURIComponent(token)}&format=json&command=getPassports`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`TIS HTTP ${res.status}`);
      const body = await res.json() as { passports?: TisPassport[] };
      if (body.passports && body.passports.length > 0) return body.passports;
      lastErr = new Error('TIS вернул пустой список');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function getPassports(force: boolean): Promise<{ at: number; passports: TisPassport[] }> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  cache = { at: Date.now(), passports: await fetchPassports() };
  return cache;
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);

/** Подсказка типа: тип машины реестра, чья модель в TIS совпадает по наибольшему числу первых слов. */
function makeTypeSuggester(known: Array<{ model: string; type: string }>) {
  return (model: string): string | null => {
    const w = words(model);
    let best: { score: number; type: string } | null = null;
    for (const k of known) {
      const kw = words(k.model);
      let n = 0;
      while (n < w.length && n < kw.length && w[n] === kw[n]) n++;
      if (n > 0 && (!best || n > best.score)) best = { score: n, type: k.type };
    }
    return best?.type ?? null;
  };
}

/** Куда ТС попадёт без реестра КИП (самосвалы/тягачи берутся из TIS автоматически). */
function autoSection(model: string): 'dump-trucks' | 'tyagachi' | null {
  const m = model.toLowerCase();
  if (m.includes('самосвал')) return 'dump-trucks';
  if (m.includes('тягач')) return 'tyagachi';
  return null;
}

export function registerTisVehicleRoutes(app: Express, deps: { kipPool: Pool }): void {
  app.get('/api/admin/vehicles/tis', async (req, res) => {
    try {
      const { at, passports } = await getPassports(req.query.refresh === '1');
      const registry = (JSON.parse(fs.readFileSync(KIP_REGISTRY_PATH, 'utf-8')) as { vehicles: KipVehicle[] }).vehicles;
      const registryByKey = new Map(registry.map(v => [dupKey(v.regNumber), v]));

      // Последний ПЛ за 30 дней по idMO (КИП сохраняет ТС из всех ПЛ, не только из реестра).
      const pl = await deps.kipPool.query<{ id_mo: string; last_pl: string }>(`
        SELECT v.id_mo, MAX(r.date_out_plan)::date::text AS last_pl
        FROM vehicles v JOIN route_lists r ON r.id = v.route_list_id
        WHERE r.date_out_plan > NOW() - INTERVAL '30 days' AND r.date_out_plan <= NOW() + INTERVAL '1 day'
          AND v.id_mo IS NOT NULL
        GROUP BY v.id_mo`);
      const lastPl = new Map(pl.rows.map(r => [Number(r.id_mo), r.last_pl]));

      const known = passports
        .filter(p => registryByKey.has(dupKey(String(p.regNumber))))
        .map(p => ({ model: p.modelOrMarkOrModif || '', type: registryByKey.get(dupKey(String(p.regNumber)))!.type }));
      const suggest = makeTypeSuggester(known);

      const tisKeys = new Set<string>();
      const items = passports
        .filter(p => p.regNumber && String(p.regNumber).trim())
        .map(p => {
          const regNumber = String(p.regNumber).replace(/\s+/g, '').toUpperCase();
          const key = dupKey(regNumber);
          tisKeys.add(key);
          const inLk = registryByKey.get(key);
          const model = p.modelOrMarkOrModif || '';
          return {
            idMO: p.idMO,
            regNumber,
            model,
            kindType: p.kindType || '',
            garageNumber: p.garageNumber || '',
            inLk: inLk ? inLk.regNumber : null,
            lastPl: lastPl.get(p.idMO) ?? null,
            autoSection: autoSection(model),
            suggestedType: inLk ? inLk.type : suggest(model),
          };
        })
        .sort((a, b) => (b.lastPl ?? '').localeCompare(a.lastPl ?? '') || a.regNumber.localeCompare(b.regNumber, 'ru'));

      res.json({
        fetchedAt: new Date(at).toISOString(),
        items,
        registryNotInTis: registry.filter(v => !tisKeys.has(dupKey(v.regNumber))).map(v => v.regNumber),
      });
    } catch (err) {
      res.status(502).json({ error: `Не удалось получить список из TIS: ${(err as Error).message}` });
    }
  });
}
