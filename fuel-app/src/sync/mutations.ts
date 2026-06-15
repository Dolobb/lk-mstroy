import { and, eq, inArray } from "drizzle-orm";
import * as Crypto from "expo-crypto";

import { atz, organizations, outbox, shifts, syncMeta, vehicles } from "../db/schema";
import { normalizeGosNumber } from "./normalize";
import { compressTtnPhoto } from "./photo-upload";
import { db, outboxStore, photoQueue } from "./services";
import type {
  DispenseUpsertEvent,
  OrgAddEvent,
  ReceiptUpsertEvent,
  ShiftCloseEvent,
  ShiftOpenEvent,
  VehicleAddEvent,
} from "./types";
import { assertValidLiters } from "./validate";

const CURRENT_SHIFT_KEY = "currentShift";

/** Локальный контекст открытой смены (для рабочего режима). */
export interface CurrentShift {
  shiftId: string;
  atzId: string;
}

function nowIso(): string {
  return new Date().toISOString();
}
function uuid(): string {
  return Crypto.randomUUID();
}

/** Открыть смену: shift_open в outbox + запомнить текущую смену (shiftId+atzId) локально. */
export async function startShift(atzId: string, openingRemainingLiters?: number | null): Promise<string> {
  const id = uuid();
  const startedAtClient = nowIso();
  const event: ShiftOpenEvent = {
    type: "shift_open",
    id,
    atzId,
    startedAtClient,
    ...(openingRemainingLiters != null ? { openingRemainingLiters } : {}),
  };
  await outboxStore.enqueue(event);
  await setCurrentShift({ shiftId: id, atzId });
  await upsertLocalShiftOpen(id, atzId, startedAtClient, openingRemainingLiters ?? null);
  return id;
}

/** Закрыть смену (id === UUID смены). */
export async function closeShift(shiftId: string, closingRemainingLiters?: number | null): Promise<void> {
  const endedAtClient = nowIso();
  const event: ShiftCloseEvent = {
    type: "shift_close",
    id: shiftId,
    endedAtClient,
    ...(closingRemainingLiters != null ? { closingRemainingLiters } : {}),
  };
  await outboxStore.enqueue(event);
  await clearCurrentShift();
  await updateLocalShiftClose(shiftId, endedAtClient, closingRemainingLiters ?? null);
}

/** Выдача топлива ТС. happenedAtClient фиксируется в момент ввода. */
export async function addDispense(shiftId: string, vehicleId: string, liters: number): Promise<string> {
  assertValidLiters(liters);
  const id = uuid();
  const event: DispenseUpsertEvent = {
    type: "dispense_upsert",
    id,
    shiftId,
    vehicleId,
    liters,
    happenedAtClient: nowIso(),
  };
  await outboxStore.enqueue(event);
  return id;
}

/** Получение топлива в АТЗ + (опц.) фото ТТН: сжать ≤500КБ и поставить в фото-очередь по id события. */
export async function addReceipt(shiftId: string, liters: number, photoUri?: string): Promise<string> {
  assertValidLiters(liters);
  const id = uuid();
  const event: ReceiptUpsertEvent = {
    type: "receipt_upsert",
    id,
    shiftId,
    liters,
    happenedAtClient: nowIso(),
  };
  await outboxStore.enqueue(event);
  if (photoUri) {
    const compressed = await compressTtnPhoto(photoUri);
    await photoQueue.enqueue(id, compressed);
  }
  return id;
}

/** Правка выдачи/получения: тот же id, новый payload + editedAt (LWW на сервере). */
export async function editEvent(id: string, patch: { liters?: number; vehicleId?: string }): Promise<void> {
  if (patch.liters !== undefined) assertValidLiters(patch.liters);
  const row = await outboxStore.byId(id);
  if (!row) return;
  const event = JSON.parse(row.payload) as DispenseUpsertEvent | ReceiptUpsertEvent;
  await outboxStore.enqueue({ ...event, ...patch, editedAt: nowIso() });
}

/** Мягкое удаление: isDeleted=true + editedAt (литры вернутся в остаток на сервере). */
export async function softDeleteEvent(id: string): Promise<void> {
  const row = await outboxStore.byId(id);
  if (!row) return;
  const event = JSON.parse(row.payload) as DispenseUpsertEvent | ReceiptUpsertEvent;
  await outboxStore.enqueue({ ...event, isDeleted: true, editedAt: nowIso() });
}

/** Новое ТС от водителя: событие vehicle_add + оптимистично в локальный кэш (чтобы сразу выбрать). */
export async function addVehicleLocal(input: {
  gosNumber: string;
  organizationId: string;
  mark?: string | null;
  vehicleType?: string | null;
}): Promise<string> {
  const id = uuid();
  const event: VehicleAddEvent = {
    type: "vehicle_add",
    id,
    gosNumber: input.gosNumber,
    organizationId: input.organizationId,
    mark: input.mark ?? null,
    vehicleType: input.vehicleType ?? null,
  };
  await outboxStore.enqueue(event);
  await db
    .insert(vehicles)
    .values({
      id,
      gosNumber: input.gosNumber,
      gosNumberNorm: normalizeGosNumber(input.gosNumber),
      mark: input.mark ?? null,
      vehicleType: input.vehicleType ?? null,
      organizationId: input.organizationId,
      source: "driver",
      isActive: true,
    })
    .onConflictDoNothing();
  return id;
}

/** Новая организация от водителя (наёмная): событие org_add + оптимистично в кэш. */
export async function addOrganizationLocal(name: string): Promise<string> {
  const id = uuid();
  const event: OrgAddEvent = { type: "org_add", id, name };
  await outboxStore.enqueue(event);
  await db
    .insert(organizations)
    .values({ id, name, kind: "hired", source: "driver" })
    .onConflictDoNothing();
  return id;
}

/**
 * Оптимистичная локальная смена (офлайн-история): таблица `shifts` иначе заполняется ТОЛЬКО из
 * bootstrap → офлайн-открытая/закрытая смена не видна в истории до синка. Пишем сразу при
 * старте/закрытии; bootstrap-reconcile потом перезапишет серверной (авторитетной) версией по id,
 * а несинхронизированные локальные смены сохранит. `status` — ровно 'open'|'closed' (контракт сервера).
 */
async function upsertLocalShiftOpen(
  shiftId: string,
  atzId: string,
  startedAtClient: string,
  openingRemainingLiters: number | null,
): Promise<void> {
  const atzRow = (await db.select().from(atz).where(eq(atz.id, atzId)).limit(1))[0];
  await db
    .insert(shifts)
    .values({
      id: shiftId,
      atzId,
      atzGosNumber: atzRow?.gosNumber ?? null,
      startedAtClient,
      endedAtClient: null,
      status: "open",
      openingRemainingLiters,
      closingRemainingLiters: null,
      dispenseCount: 0,
      dispenseLiters: 0,
      receiptLiters: 0,
    })
    .onConflictDoNothing();
}

/** Закрытие: статус 'closed' + агрегаты смены из локального outbox (чтобы офлайн-история была не пустой). */
async function updateLocalShiftClose(
  shiftId: string,
  endedAtClient: string,
  closingRemainingLiters: number | null,
): Promise<void> {
  const rows = await db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.shiftId, shiftId), inArray(outbox.type, ["dispense_upsert", "receipt_upsert"])));
  let dispenseCount = 0;
  let dispenseLiters = 0;
  let receiptLiters = 0;
  for (const r of rows) {
    const p = JSON.parse(r.payload) as DispenseUpsertEvent | ReceiptUpsertEvent;
    if (p.isDeleted) continue;
    if (p.type === "dispense_upsert") {
      dispenseCount += 1;
      dispenseLiters += p.liters;
    } else {
      receiptLiters += p.liters;
    }
  }
  await db
    .update(shifts)
    .set({ status: "closed", endedAtClient, closingRemainingLiters, dispenseCount, dispenseLiters, receiptLiters })
    .where(eq(shifts.id, shiftId));
}

async function setCurrentShift(shift: CurrentShift): Promise<void> {
  await db
    .insert(syncMeta)
    .values({ key: CURRENT_SHIFT_KEY, value: JSON.stringify(shift) })
    .onConflictDoUpdate({ target: syncMeta.key, set: { value: JSON.stringify(shift) } });
}
async function clearCurrentShift(): Promise<void> {
  await db.delete(syncMeta).where(eq(syncMeta.key, CURRENT_SHIFT_KEY));
}
export async function getCurrentShift(): Promise<CurrentShift | null> {
  const rows = await db.select().from(syncMeta).where(eq(syncMeta.key, CURRENT_SHIFT_KEY)).limit(1);
  if (!rows[0]) return null;
  return JSON.parse(rows[0].value) as CurrentShift;
}
