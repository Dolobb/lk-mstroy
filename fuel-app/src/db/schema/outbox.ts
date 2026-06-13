import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Outbox — сердце офлайн-синка (зона Claude).
 *
 * Каждая локальная мутация (старт/закрытие смены, выдача, получение, добавление ТС/орг,
 * правка, удаление) = одна строка-событие. PK = client-UUID = `id` события → идемпотентность:
 * повторная отправка с тем же id на сервере делает upsert, дубля нет.
 *
 * `payload` хранит КАНОНИЧЕСКИЙ JSON ровно того события, что уйдёт в `POST /sync`
 * (строгая форма из бэкенда sync.types.ts, `.strict()` — без лишних ключей). Источник
 * истины при отправке — `payload`. Денорм-колонки ниже — только для запросов UI/порядка.
 *
 * Правка события = UPDATE этой же строки по `id` (тот же UUID) с новым `payload`
 * (editedAt выставлен) и `status='pending'` для переотправки. Удаление — payload с
 * `isDeleted=true`, тоже переотправка. Строка НЕ удаляется до ACK сервера (`status='confirmed'`);
 * confirmed-события остаются для отображения в таблице смены (бэкенд отдаёт только агрегаты смен,
 * не отдельные события — локальный outbox и есть журнал событий водителя).
 */
export const outbox = sqliteTable(
  "outbox",
  {
    /** client-UUID = id события (PK, идемпотентность upsert на сервере) */
    id: text("id").primaryKey(),
    /** org_add | vehicle_add | shift_open | shift_close | dispense_upsert | receipt_upsert */
    type: text("type").notNull(),
    /** канонический JSON строгого события (что отправляем в /sync) */
    payload: text("payload").notNull(),
    /** pending → in_flight → confirmed; либо conflict | error (см. conflictCode) */
    status: text("status").notNull().default("pending"),
    /** денорм: смена события (dispense/receipt/shift_close) — для группировки/отображения */
    shiftId: text("shift_id"),
    /** денорм ISO-с-offset: «когда произошло» (снимок при вводе) — порядок и показ */
    happenedAtClient: text("happened_at_client"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    /** счётчик попыток отправки (для backoff/диагностики) */
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    /** код конфликта сервера при status='conflict' (atz_busy|stale|*_not_found|forbidden|shift_mismatch) */
    conflictCode: text("conflict_code"),
    /** человекочитаемое сообщение об ошибке/конфликте (message из ответа) */
    lastError: text("last_error"),
  },
  (table) => [
    index("outbox_status_idx").on(table.status),
    index("outbox_shift_id_idx").on(table.shiftId),
  ],
);

/**
 * Фото-очередь ТТН — отдельно от событий (файлы большие, грузятся независимо
 * через `POST /uploads/ttn` ПОСЛЕ того как соответствующее receipt-событие подтверждено).
 * Ключ = UUID receipt-события (= ключ загрузки на сервере). Фото жмётся ≤500 КБ до постановки в очередь.
 */
export const photoQueue = sqliteTable(
  "photo_queue",
  {
    /** = id receipt-события (UUID); ключ /uploads/ttn */
    receiptId: text("receipt_id").primaryKey(),
    /** локальный URI сжатого (≤500 КБ) файла */
    localUri: text("local_uri").notNull(),
    /** pending → in_flight → uploaded; либо error */
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("photo_queue_status_idx").on(table.status)],
);
