/**
 * Клиентское зеркало СТРОГОГО контракта `/sync` бэкенда
 * (fuel-backend/src/services/sync.types.ts). Клиент собирает РОВНО эти события
 * (никаких лишних ключей — сервер валидирует `.strict()`) и шлёт в `POST /sync`.
 *
 * Это источник истины по типам для всего sync-ядра. UI-обвязка (3.3e) импортит отсюда.
 */

/** ISO-8601 строка С offset (напр. "2026-06-13T10:30:00+03:00") */
export type IsoDateTime = string;

export interface OrgAddEvent {
  type: "org_add";
  id: string;
  name: string;
}

export interface VehicleAddEvent {
  type: "vehicle_add";
  id: string;
  gosNumber: string;
  mark?: string | null;
  vehicleType?: string | null;
  organizationId: string;
}

export interface ShiftOpenEvent {
  type: "shift_open";
  id: string;
  atzId: string;
  startedAtClient: IsoDateTime;
  openingRemainingLiters?: number | null;
}

export interface ShiftCloseEvent {
  type: "shift_close";
  /** id === UUID той же смены (shift_open и shift_close несут один id) */
  id: string;
  endedAtClient: IsoDateTime;
  closingRemainingLiters?: number | null;
}

export interface DispenseUpsertEvent {
  type: "dispense_upsert";
  id: string;
  shiftId: string;
  vehicleId: string;
  liters: number;
  happenedAtClient: IsoDateTime;
  isDeleted?: boolean;
  editedAt?: IsoDateTime | null;
}

export interface ReceiptUpsertEvent {
  type: "receipt_upsert";
  id: string;
  shiftId: string;
  liters: number;
  happenedAtClient: IsoDateTime;
  isDeleted?: boolean;
  editedAt?: IsoDateTime | null;
}

export type SyncEvent =
  | OrgAddEvent
  | VehicleAddEvent
  | ShiftOpenEvent
  | ShiftCloseEvent
  | DispenseUpsertEvent
  | ReceiptUpsertEvent;

export type SyncEventType = SyncEvent["type"];

export interface SyncRequest {
  deviceId: string;
  events: SyncEvent[];
}

export type ResultStatus = "applied" | "conflict" | "error";

/** Коды конфликтов сервера (см. Sync-API.md) */
export type ConflictCode =
  | "atz_busy"
  | "atz_not_found"
  | "atz_inactive"
  | "shift_not_found"
  | "forbidden"
  | "shift_mismatch"
  | "vehicle_not_found"
  | "org_not_found"
  | "stale";

export interface SyncResult {
  id: string;
  type: string;
  status: ResultStatus;
  code?: ConflictCode | string;
  message?: string;
}

export interface AtzBalance {
  atzId: string;
  remainingLiters: number;
}

export interface SyncResponse {
  serverTime: string;
  results: SyncResult[];
  atzBalances: AtzBalance[];
}

/** Локальный жизненный цикл строки outbox */
export type OutboxStatus = "pending" | "in_flight" | "confirmed" | "conflict" | "error";
