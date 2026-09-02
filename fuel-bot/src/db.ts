/**
 * Локальная база бота.
 *
 * Схема повторяет боевую (fuel-backend/src/db/schema.ts), но урезана до того,
 * что нужно боту, и лежит в SQLite. Используется встроенный в Node модуль
 * `node:sqlite` — поэтому у проекта нет ни одной нативной зависимости.
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const DB_PATH = process.env.DB_PATH?.trim() || "./fuel-bot.db";

/**
 * Открывает базу и понятно ругается, если DB_PATH указывает не туда.
 *
 * Частая ошибка: автодополнение в редакторе подставляет в .env путь к исходнику
 * (`src/db.ts`) вместо файла базы. SQLite в этом случае бросает голое
 * «file is not a database» — по такому сообщению причину не найти.
 */
function openDatabase(path: string): DatabaseSync {
  if (/\.(ts|js|mjs|json|md)$/i.test(path)) {
    exit(`DB_PATH указывает на файл с кодом: ${path}\nНужен путь к базе, например ./fuel-bot.db`);
  }

  try {
    const conn = new DatabaseSync(path);
    conn.exec("PRAGMA foreign_keys = ON");
    return conn;
  } catch (err) {
    const code = (err as { errstr?: string }).errstr ?? String(err);
    exit(
      `Не удалось открыть базу ${path}: ${code}\n` +
        "Проверьте DB_PATH в .env — там должен быть путь к файлу базы (./fuel-bot.db).\n" +
        "Если файл повреждён, удалите его: он создастся заново."
    );
  }
}

function exit(message: string): never {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

export const db = openDatabase(DB_PATH);

// ── Схема ────────────────────────────────────────────────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS drivers (
  id          TEXT PRIMARY KEY,
  login       TEXT NOT NULL UNIQUE,
  pin         TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  tg_user_id  INTEGER UNIQUE            -- к какому Telegram-аккаунту привязан
);

CREATE TABLE IF NOT EXISTS atz (
  id               TEXT PRIMARY KEY,
  gos_number       TEXT NOT NULL,
  title            TEXT,
  remaining_liters REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS organizations (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id              TEXT PRIMARY KEY,
  gos_number      TEXT NOT NULL,
  mark            TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id)
);

CREATE INDEX IF NOT EXISTS vehicles_gos_number_idx ON vehicles(gos_number);

CREATE TABLE IF NOT EXISTS shifts (
  id                       TEXT PRIMARY KEY,
  driver_id                TEXT NOT NULL REFERENCES drivers(id),
  atz_id                   TEXT NOT NULL REFERENCES atz(id),
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_remaining_liters REAL NOT NULL,
  closing_remaining_liters REAL,
  started_at               TEXT NOT NULL,
  ended_at                 TEXT
);

-- Одна открытая смена на один АТЗ. Тот же инвариант, что в боевой базе.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_shift_per_atz
  ON shifts(atz_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS dispense_events (
  id             TEXT PRIMARY KEY,
  shift_id       TEXT NOT NULL REFERENCES shifts(id),
  vehicle_id     TEXT NOT NULL REFERENCES vehicles(id),
  liters         REAL NOT NULL,
  recipient_name TEXT NOT NULL,
  happened_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipt_events (
  id          TEXT PRIMARY KEY,
  shift_id    TEXT NOT NULL REFERENCES shifts(id),
  liters      REAL NOT NULL,
  happened_at TEXT NOT NULL
);
`);

// ── Типы строк ───────────────────────────────────────────────────────────────

export type Driver = { id: string; login: string; pin: string; full_name: string; tg_user_id: number | null };
export type Atz = { id: string; gos_number: string; title: string | null; remaining_liters: number };
export type Vehicle = { id: string; gos_number: string; mark: string | null; org_name: string };
export type Shift = {
  id: string;
  driver_id: string;
  atz_id: string;
  status: "open" | "closed";
  opening_remaining_liters: number;
  closing_remaining_liters: number | null;
  started_at: string;
  ended_at: string | null;
};

// ── Сид ──────────────────────────────────────────────────────────────────────

/** Наполняет базу демо-данными. Идемпотентно: повторный вызов ничего не сломает. */
export function seed(): void {
  const already = db.prepare("SELECT COUNT(*) AS n FROM drivers").get() as { n: number };
  if (already.n > 0) return;

  const insDriver = db.prepare("INSERT INTO drivers (id, login, pin, full_name) VALUES (?, ?, ?, ?)");
  insDriver.run(randomUUID(), "test-driver", "1234", "Иванов И.И.");
  insDriver.run(randomUUID(), "petrov", "5678", "Петров П.П.");

  const insAtz = db.prepare("INSERT INTO atz (id, gos_number, title, remaining_liters) VALUES (?, ?, ?, ?)");
  insAtz.run(randomUUID(), "А001АА777", "АТЗ-1 · КамАЗ 43118", 5000);
  insAtz.run(randomUUID(), "В202ВВ716", "АТЗ-2 · Урал 4320", 3200);

  const orgs: Array<[string, string]> = [
    [randomUUID(), "Мостоотряд 36"],
    [randomUUID(), "СУ-7 Подряд"],
    [randomUUID(), "ТрансСтрой"]
  ];
  const insOrg = db.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)");
  for (const [id, name] of orgs) insOrg.run(id, name);

  const insVeh = db.prepare("INSERT INTO vehicles (id, gos_number, mark, organization_id) VALUES (?, ?, ?, ?)");
  const fleet: Array<[string, string, number]> = [
    ["Е701КХ72", "КамАЗ 6520", 0],
    ["Е702КХ72", "КамАЗ 6520", 0],
    ["Е715КХ72", "МАЗ 6501", 0],
    ["Х330ТТ96", "Volvo FMX", 1],
    ["Х447ТТ96", "Scania P440", 1],
    ["Т812УУ174", "Komatsu PC300", 2],
    ["Т330УУ174", "Hitachi ZX330", 2],
    ["К159МН96", "МАЗ 5516", 2]
  ];
  for (const [gos, mark, orgIdx] of fleet) {
    insVeh.run(randomUUID(), gos, mark, orgs[orgIdx]![0]);
  }
}

// ── Запросы ──────────────────────────────────────────────────────────────────

export function findDriverByPin(pin: string): Driver | null {
  return (db.prepare("SELECT * FROM drivers WHERE pin = ?").get(pin) as Driver | undefined) ?? null;
}

export function findDriverByTgId(tgUserId: number): Driver | null {
  return (db.prepare("SELECT * FROM drivers WHERE tg_user_id = ?").get(tgUserId) as Driver | undefined) ?? null;
}

export function bindDriverToTg(driverId: string, tgUserId: number): void {
  // Один Telegram-аккаунт — один водитель: снимаем привязку с прежнего владельца.
  db.prepare("UPDATE drivers SET tg_user_id = NULL WHERE tg_user_id = ?").run(tgUserId);
  db.prepare("UPDATE drivers SET tg_user_id = ? WHERE id = ?").run(tgUserId, driverId);
}

export function unbindTg(tgUserId: number): void {
  db.prepare("UPDATE drivers SET tg_user_id = NULL WHERE tg_user_id = ?").run(tgUserId);
}

export function listAtz(): Atz[] {
  return db.prepare("SELECT * FROM atz ORDER BY gos_number").all() as Atz[];
}

export function getAtz(id: string): Atz | null {
  return (db.prepare("SELECT * FROM atz WHERE id = ?").get(id) as Atz | undefined) ?? null;
}

export function findOpenShift(driverId: string): Shift | null {
  return (
    (db
      .prepare("SELECT * FROM shifts WHERE driver_id = ? AND status = 'open'")
      .get(driverId) as Shift | undefined) ?? null
  );
}

export function getShift(id: string): Shift | null {
  return (db.prepare("SELECT * FROM shifts WHERE id = ?").get(id) as Shift | undefined) ?? null;
}

export function getOpenShiftForAtz(atzId: string): Shift | null {
  return (
    (db.prepare("SELECT * FROM shifts WHERE atz_id = ? AND status = 'open'").get(atzId) as Shift | undefined) ?? null
  );
}

/** Поиск ТС по части госномера. Регистр и пробелы игнорируются. */
export function searchVehicles(query: string, limit = 8): Vehicle[] {
  const norm = `%${query.replace(/\s/g, "").toUpperCase()}%`;
  return db
    .prepare(
      `SELECT v.id, v.gos_number, v.mark, o.name AS org_name
         FROM vehicles v
         JOIN organizations o ON o.id = v.organization_id
        WHERE UPPER(REPLACE(v.gos_number, ' ', '')) LIKE ?
        ORDER BY v.gos_number
        LIMIT ?`
    )
    .all(norm, limit) as Vehicle[];
}

export function getVehicle(id: string): Vehicle | null {
  return (
    (db
      .prepare(
        `SELECT v.id, v.gos_number, v.mark, o.name AS org_name
           FROM vehicles v JOIN organizations o ON o.id = v.organization_id
          WHERE v.id = ?`
      )
      .get(id) as Vehicle | undefined) ?? null
  );
}

export function shiftTotals(shiftId: string): { dispensed: number; received: number; count: number } {
  const d = db
    .prepare("SELECT COALESCE(SUM(liters), 0) AS s, COUNT(*) AS n FROM dispense_events WHERE shift_id = ?")
    .get(shiftId) as { s: number; n: number };
  const r = db
    .prepare("SELECT COALESCE(SUM(liters), 0) AS s FROM receipt_events WHERE shift_id = ?")
    .get(shiftId) as { s: number };
  return { dispensed: d.s, received: r.s, count: d.n };
}

export function listDispenses(shiftId: string, limit = 10) {
  return db
    .prepare(
      `SELECT d.liters, d.recipient_name, d.happened_at, v.gos_number, v.mark
         FROM dispense_events d JOIN vehicles v ON v.id = d.vehicle_id
        WHERE d.shift_id = ?
        ORDER BY d.happened_at DESC
        LIMIT ?`
    )
    .all(shiftId, limit) as Array<{
    liters: number;
    recipient_name: string;
    happened_at: string;
    gos_number: string;
    mark: string | null;
  }>;
}

// Запуск `npm run seed` наполняет базу без старта бота.
if (process.argv.includes("--seed")) {
  seed();
  console.log("База наполнена демо-данными:", DB_PATH);
}
