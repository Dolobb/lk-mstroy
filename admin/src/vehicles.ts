/**
 * Раздел «Техника»: правка списка техники, которую выгружает КИП
 * (kip/config/vehicle-registry.json). Остальные пайплайны своих списков не имеют:
 * самосвалы и тягачи берут ТС из путевых листов TIS, аналитика — из КИП.
 *
 * Запись: валидация → бэкап (*.bak-YYYYMMDD-HHMMSS, последние 20) → tmp-файл → rename.
 * КИП и аналитика перечитывают файл по mtime — рестарт не нужен.
 */
import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { log } from './logger';

export const KIP_REGISTRY_PATH = path.resolve(__dirname, '../../kip/config/vehicle-registry.json');
const BACKUP_KEEP = 20;

export interface KipVehicle {
  regNumber: string;
  type: string;
  branch: string;
  fuelNorm: number;
}

interface RegistryFile {
  vehicles: KipVehicle[];
  [key: string]: unknown;
}

// Латиница, похожая на кириллицу в госномерах: «А123ВС» латиницей и кириллицей — один и тот же номер.
const LOOKALIKE: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };

export function normalizeRegNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

function dupKey(regNumber: string): string {
  return normalizeRegNumber(regNumber).replace(/[ABEKMHOPCTYX]/g, ch => LOOKALIKE[ch]);
}

function readRegistry(): RegistryFile {
  const data = JSON.parse(fs.readFileSync(KIP_REGISTRY_PATH, 'utf-8')) as RegistryFile;
  if (!Array.isArray(data.vehicles)) throw new Error('vehicle-registry.json: нет массива vehicles');
  return data;
}

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backupAndRotate(): string {
  const dir = path.dirname(KIP_REGISTRY_PATH);
  const base = path.basename(KIP_REGISTRY_PATH);
  let backup = path.join(dir, `${base}.bak-${timestamp()}`);
  for (let i = 1; fs.existsSync(backup); i++) backup = path.join(dir, `${base}.bak-${timestamp()}-${i}`);
  fs.copyFileSync(KIP_REGISTRY_PATH, backup);
  const old = fs.readdirSync(dir)
    .filter(f => f.startsWith(`${base}.bak-`))
    .sort()
    .reverse()
    .slice(BACKUP_KEEP);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  return path.basename(backup);
}

function writeRegistryAtomic(data: RegistryFile): void {
  const tmp = `${KIP_REGISTRY_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, KIP_REGISTRY_PATH);
}

/** Валидация полей. Возвращает нормализованную запись или текст ошибки по-русски. */
function validate(body: unknown): KipVehicle | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const regNumber = normalizeRegNumber(String(b.regNumber ?? ''));
  const type = String(b.type ?? '').trim();
  const branch = String(b.branch ?? '').trim();
  const normRaw = b.fuelNorm === '' || b.fuelNorm == null ? 0 : Number(String(b.fuelNorm).replace(',', '.'));

  if (!regNumber) return 'Укажите госномер';
  if (regNumber.length < 4 || regNumber.length > 15) return 'Госномер должен быть от 4 до 15 символов';
  if (!/^[0-9A-ZА-ЯЁ-]+$/.test(regNumber)) return 'Госномер: только буквы и цифры, без спецсимволов';
  if (!type) return 'Укажите тип техники';
  if (type.length > 100) return 'Тип техники — не длиннее 100 символов';
  if (!branch) return 'Укажите филиал (если неизвестен — «Не указан»)';
  if (branch.length > 100) return 'Филиал — не длиннее 100 символов';
  if (!Number.isFinite(normRaw) || normRaw < 0 || normRaw > 500) return 'Норма расхода — число от 0 до 500 (л/ч); 0 — норма не задана';
  return { regNumber, type, branch, fuelNorm: Math.round(normRaw * 100) / 100 };
}

// Все записи — по очереди, чтобы два одновременных сохранения не затёрли друг друга.
let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => T): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.catch(() => undefined);
  return run;
}

function sendList(res: Response, extra: Record<string, unknown> = {}): void {
  const data = readRegistry();
  const vehicles = [...data.vehicles].sort((a, b) => a.regNumber.localeCompare(b.regNumber, 'ru'));
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  res.json({
    vehicles,
    types: uniq(vehicles.map(v => v.type)),
    branches: uniq(vehicles.map(v => v.branch)),
    updatedAt: fs.statSync(KIP_REGISTRY_PATH).mtime.toISOString(),
    ...extra,
  });
}

export function registerVehicleRoutes(app: Express): void {
  app.get('/api/admin/vehicles/kip', (_req, res) => {
    try { sendList(res); } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.post('/api/admin/vehicles/kip', async (req: Request, res: Response) => {
    const v = validate(req.body);
    if (typeof v === 'string') return res.status(400).json({ error: v });
    try {
      await serialized(() => {
        const data = readRegistry();
        const dup = data.vehicles.find(x => dupKey(x.regNumber) === dupKey(v.regNumber));
        if (dup) throw Object.assign(new Error(`Техника с госномером ${dup.regNumber} уже есть в списке`), { status: 409 });
        const backup = backupAndRotate();
        data.vehicles.push(v);
        writeRegistryAtomic(data);
        log.info({ category: 'admin', msg: 'Техника: добавлена', fields: { ...v, backup } });
      });
      sendList(res, { saved: v.regNumber });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  app.put('/api/admin/vehicles/kip/:regNumber', async (req: Request, res: Response) => {
    const original = normalizeRegNumber(req.params.regNumber);
    const v = validate(req.body);
    if (typeof v === 'string') return res.status(400).json({ error: v });
    try {
      await serialized(() => {
        const data = readRegistry();
        const idx = data.vehicles.findIndex(x => normalizeRegNumber(x.regNumber) === original);
        if (idx < 0) throw Object.assign(new Error(`Техника ${original} не найдена — обновите страницу`), { status: 404 });
        const dup = data.vehicles.find((x, i) => i !== idx && dupKey(x.regNumber) === dupKey(v.regNumber));
        if (dup) throw Object.assign(new Error(`Техника с госномером ${dup.regNumber} уже есть в списке`), { status: 409 });
        const before = data.vehicles[idx];
        const backup = backupAndRotate();
        data.vehicles[idx] = v;
        writeRegistryAtomic(data);
        log.info({ category: 'admin', msg: 'Техника: изменена', fields: { before, after: v, backup } });
      });
      sendList(res, { saved: v.regNumber });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/vehicles/kip/:regNumber', async (req: Request, res: Response) => {
    const target = normalizeRegNumber(req.params.regNumber);
    try {
      await serialized(() => {
        const data = readRegistry();
        const idx = data.vehicles.findIndex(x => normalizeRegNumber(x.regNumber) === target);
        if (idx < 0) throw Object.assign(new Error(`Техника ${target} не найдена — обновите страницу`), { status: 404 });
        const backup = backupAndRotate();
        const [removed] = data.vehicles.splice(idx, 1);
        writeRegistryAtomic(data);
        log.info({ category: 'admin', msg: 'Техника: удалена', fields: { removed, backup } });
      });
      sendList(res, { deleted: target });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });
}
