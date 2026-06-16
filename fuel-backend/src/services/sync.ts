// Ядро /sync. Пишет/ревьюит Claude (задача A7). Codex этот файл не редактирует — см. AGENTS.md.
//
// Гарантии:
// - Идемпотентность: PK событий — client-UUID; ретрай батча не дублирует строки и не двигает остаток.
// - Остаток АТЗ — инкрементальный running tally: дельта считается только по фактически
//   применённым изменениям внутри той же транзакции (ручная psql-калибровка не затирается).
// - «Один АТЗ = одна открытая смена»: частичный уникальный индекс uniq_open_shift_per_atz,
//   нарушение конвертируется в conflict {code: 'atz_busy'}.
// - Правки: last-write-wins по editedAt; ретрай оригинала (editedAt=null) ничего не перезаписывает;
//   каждая применённая правка пишет before/after в event_edits.
// - Батч — одна транзакция; каждое событие — savepoint: ошибка события не валит батч.

import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  atz,
  eventEdits,
  fuelDispenseEvents,
  fuelReceiptEvents,
  organizations,
  shifts,
  vehicles
} from "../db/schema.js";
import type { SyncEvent, SyncRequest, SyncResponse, SyncResult, SyncService } from "./sync.types.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Порядок применения по зависимостям, независимо от порядка в массиве клиента
const TYPE_PRIORITY: Record<SyncEvent["type"], number> = {
  org_add: 0,
  vehicle_add: 1,
  shift_open: 2,
  dispense_upsert: 3,
  receipt_upsert: 3,
  shift_close: 4
};

type EventOutcome = {
  result: SyncResult;
  // Дельта остатка в центилитрах — применяется к АТЗ ТОЛЬКО после успешного savepoint
  delta?: { atzId: string; centi: number };
  // АТЗ, чей текущий остаток нужно вернуть клиенту (даже при дельте 0)
  touchAtzIds?: string[];
};

function toCenti(liters: number): number {
  return Math.round(liters * 100);
}

function numericToCenti(value: string | null): number {
  return value === null ? 0 : Math.round(Number(value) * 100);
}

function toNumeric(liters: number): string {
  return liters.toFixed(2);
}

function applied(event: SyncEvent): SyncResult {
  return { id: event.id, type: event.type, status: "applied" };
}

function conflict(event: SyncEvent, code: string, message: string): SyncResult {
  return { id: event.id, type: event.type, status: "conflict", code, message };
}

function findPgError(error: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^\d{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : undefined
      };
    }
    current = candidate.cause;
  }
  return null;
}

class DrizzleSyncService implements SyncService {
  async process(driverId: string, request: SyncRequest): Promise<SyncResponse> {
    const serverTime = new Date().toISOString();
    const resultsByIndex: SyncResult[] = new Array<SyncResult>(request.events.length);
    const deltasByAtzId = new Map<string, number>();
    const touchedAtzIds = new Set<string>();

    const orderedIndexes = request.events
      .map((event, index) => ({ event, index }))
      .sort(
        (left, right) =>
          TYPE_PRIORITY[left.event.type] - TYPE_PRIORITY[right.event.type] ||
          left.index - right.index
      );

    const atzBalances = await db.transaction(async (tx) => {
      for (const { event, index } of orderedIndexes) {
        let outcome: EventOutcome;
        try {
          // Вложенная транзакция = savepoint: SQL-ошибка события откатывает только его
          outcome = await tx.transaction((sp) =>
            this.applyEvent(sp, driverId, request.deviceId, event)
          );
        } catch (error) {
          const pgError = findPgError(error);
          if (pgError?.code === "23505" && pgError.constraint === "uniq_open_shift_per_atz") {
            outcome = {
              result: conflict(event, "atz_busy", "На этом АТЗ уже открыта смена")
            };
          } else {
            outcome = {
              result: {
                id: event.id,
                type: event.type,
                status: "error",
                code: "internal",
                message: "Внутренняя ошибка обработки события"
              }
            };
          }
        }

        resultsByIndex[index] = outcome.result;
        if (outcome.delta && outcome.delta.centi !== 0) {
          deltasByAtzId.set(
            outcome.delta.atzId,
            (deltasByAtzId.get(outcome.delta.atzId) ?? 0) + outcome.delta.centi
          );
        }
        for (const atzId of outcome.touchAtzIds ?? []) {
          touchedAtzIds.add(atzId);
        }
      }

      for (const [atzId, deltaCenti] of deltasByAtzId) {
        await tx
          .update(atz)
          .set({
            remainingLiters: sql`${atz.remainingLiters} + ${toNumeric(deltaCenti / 100)}::numeric`,
            updatedAt: new Date() // планшеты увидят новый остаток через дельту /bootstrap
          })
          .where(eq(atz.id, atzId));
      }

      const ids = [...touchedAtzIds];
      if (ids.length === 0) {
        return [];
      }
      const rows = await tx
        .select({ atzId: atz.id, remainingLiters: atz.remainingLiters })
        .from(atz)
        .where(inArray(atz.id, ids));
      return rows.map((row) => ({
        atzId: row.atzId,
        remainingLiters: Number(row.remainingLiters ?? 0)
      }));
    });

    return { serverTime, results: resultsByIndex, atzBalances };
  }

  private async applyEvent(
    tx: Tx,
    driverId: string,
    deviceId: string,
    event: SyncEvent
  ): Promise<EventOutcome> {
    switch (event.type) {
      case "org_add":
        return this.applyOrgAdd(tx, event);
      case "vehicle_add":
        return this.applyVehicleAdd(tx, event);
      case "shift_open":
        return this.applyShiftOpen(tx, driverId, deviceId, event);
      case "shift_close":
        return this.applyShiftClose(tx, driverId, event);
      case "dispense_upsert":
        return this.applyDispenseUpsert(tx, driverId, deviceId, event);
      case "receipt_upsert":
        return this.applyReceiptUpsert(tx, driverId, deviceId, event);
    }
  }

  private async applyOrgAdd(
    tx: Tx,
    event: Extract<SyncEvent, { type: "org_add" }>
  ): Promise<EventOutcome> {
    // Организации от водителя всегда наёмные (Tech-Interview-Decisions)
    await tx
      .insert(organizations)
      .values({ id: event.id, name: event.name, kind: "hired", source: "driver" })
      .onConflictDoNothing({ target: organizations.id });
    return { result: applied(event) };
  }

  private async applyVehicleAdd(
    tx: Tx,
    event: Extract<SyncEvent, { type: "vehicle_add" }>
  ): Promise<EventOutcome> {
    const [existing] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, event.id))
      .limit(1);
    if (existing) {
      return { result: applied(event) }; // идемпотентный ретрай
    }

    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, event.organizationId))
      .limit(1);
    if (!organization) {
      return { result: conflict(event, "org_not_found", "Организация не найдена на сервере") };
    }

    await tx
      .insert(vehicles)
      .values({
        id: event.id,
        gosNumber: event.gosNumber,
        mark: event.mark ?? null,
        vehicleType: event.vehicleType ?? null,
        organizationId: event.organizationId,
        source: "driver"
      })
      .onConflictDoNothing({ target: vehicles.id });
    return { result: applied(event) };
  }

  private async applyShiftOpen(
    tx: Tx,
    driverId: string,
    deviceId: string,
    event: Extract<SyncEvent, { type: "shift_open" }>
  ): Promise<EventOutcome> {
    const [existing] = await tx
      .select({ driverId: shifts.driverId, atzId: shifts.atzId })
      .from(shifts)
      .where(eq(shifts.id, event.id))
      .limit(1);
    if (existing) {
      if (existing.driverId !== driverId) {
        return { result: conflict(event, "forbidden", "Смена принадлежит другому водителю") };
      }
      return { result: applied(event), touchAtzIds: [existing.atzId] }; // ретрай
    }

    const [atzRow] = await tx
      .select({ id: atz.id, isActive: atz.isActive })
      .from(atz)
      .where(eq(atz.id, event.atzId))
      .limit(1);
    if (!atzRow) {
      return { result: conflict(event, "atz_not_found", "АТЗ не найден") };
    }
    if (atzRow.isActive === false) {
      return { result: conflict(event, "atz_inactive", "АТЗ деактивирован администратором") };
    }

    // Нарушение uniq_open_shift_per_atz ловится уровнем выше → conflict atz_busy
    await tx.insert(shifts).values({
      id: event.id,
      driverId,
      atzId: event.atzId,
      startedAtClient: new Date(event.startedAtClient),
      status: "open",
      openingRemainingLiters:
        event.openingRemainingLiters == null ? null : toNumeric(event.openingRemainingLiters),
      deviceId
    });
    return { result: applied(event), touchAtzIds: [event.atzId] };
  }

  private async applyShiftClose(
    tx: Tx,
    driverId: string,
    event: Extract<SyncEvent, { type: "shift_close" }>
  ): Promise<EventOutcome> {
    const [shift] = await tx
      .select({ driverId: shifts.driverId, atzId: shifts.atzId, status: shifts.status })
      .from(shifts)
      .where(eq(shifts.id, event.id))
      .limit(1);
    if (!shift) {
      return { result: conflict(event, "shift_not_found", "Смена не найдена на сервере") };
    }
    if (shift.driverId !== driverId) {
      return { result: conflict(event, "forbidden", "Смена принадлежит другому водителю") };
    }
    if (shift.status === "closed") {
      return { result: applied(event), touchAtzIds: [shift.atzId] }; // ретрай закрытия
    }

    await tx
      .update(shifts)
      .set({
        status: "closed",
        endedAtClient: new Date(event.endedAtClient),
        endedAtServer: new Date(),
        closingRemainingLiters:
          event.closingRemainingLiters == null ? null : toNumeric(event.closingRemainingLiters)
      })
      .where(eq(shifts.id, event.id));
    return { result: applied(event), touchAtzIds: [shift.atzId] };
  }

  private async applyDispenseUpsert(
    tx: Tx,
    driverId: string,
    deviceId: string,
    event: Extract<SyncEvent, { type: "dispense_upsert" }>
  ): Promise<EventOutcome> {
    const shift = await this.loadOwnShift(tx, driverId, event.shiftId);
    if ("conflict" in shift) {
      return { result: conflict(event, shift.conflict.code, shift.conflict.message) };
    }

    const [existing] = await tx
      .select()
      .from(fuelDispenseEvents)
      .where(eq(fuelDispenseEvents.id, event.id))
      .limit(1);

    if (!existing) {
      const vehicleConflict = await this.checkVehicleExists(tx, event.vehicleId);
      if (vehicleConflict) {
        return { result: conflict(event, vehicleConflict.code, vehicleConflict.message) };
      }
      const isDeleted = event.isDeleted ?? false;
      await tx.insert(fuelDispenseEvents).values({
        id: event.id,
        shiftId: event.shiftId,
        vehicleId: event.vehicleId,
        liters: toNumeric(event.liters),
        recipientName: event.recipientName,
        happenedAtClient: new Date(event.happenedAtClient),
        isDeleted,
        editedAt: event.editedAt ? new Date(event.editedAt) : null,
        deviceId
      });
      return {
        result: applied(event),
        delta: { atzId: shift.atzId, centi: isDeleted ? 0 : -toCenti(event.liters) },
        touchAtzIds: [shift.atzId]
      };
    }

    if (existing.shiftId !== event.shiftId) {
      return {
        result: conflict(event, "shift_mismatch", "Событие принадлежит другой смене")
      };
    }

    const lww = this.resolveLastWriteWins(event, existing.editedAt);
    if (lww !== "apply") {
      return {
        result:
          lww === "noop"
            ? applied(event)
            : conflict(event, "stale", "На сервере более новая версия события"),
        touchAtzIds: [shift.atzId]
      };
    }

    if (event.vehicleId !== existing.vehicleId) {
      const vehicleConflict = await this.checkVehicleExists(tx, event.vehicleId);
      if (vehicleConflict) {
        return { result: conflict(event, vehicleConflict.code, vehicleConflict.message) };
      }
    }

    const isDeleted = event.isDeleted ?? false;
    const oldEffectiveCenti = existing.isDeleted ? 0 : numericToCenti(existing.liters);
    const newEffectiveCenti = isDeleted ? 0 : toCenti(event.liters);

    await tx.insert(eventEdits).values({
      eventId: event.id,
      eventType: "dispense",
      before: {
        liters: existing.liters,
        vehicleId: existing.vehicleId,
        recipientName: existing.recipientName,
        happenedAtClient: existing.happenedAtClient.toISOString(),
        isDeleted: existing.isDeleted,
        editedAt: existing.editedAt?.toISOString() ?? null
      },
      after: {
        liters: toNumeric(event.liters),
        vehicleId: event.vehicleId,
        recipientName: event.recipientName,
        happenedAtClient: event.happenedAtClient,
        isDeleted,
        editedAt: event.editedAt ?? null
      }
    });
    // received_at_server не трогаем — это метка ПЕРВОГО получения (см. AGENTS.md)
    await tx
      .update(fuelDispenseEvents)
      .set({
        liters: toNumeric(event.liters),
        vehicleId: event.vehicleId,
        recipientName: event.recipientName,
        happenedAtClient: new Date(event.happenedAtClient),
        isDeleted,
        editedAt: event.editedAt ? new Date(event.editedAt) : null
      })
      .where(eq(fuelDispenseEvents.id, event.id));

    return {
      result: applied(event),
      delta: { atzId: shift.atzId, centi: -(newEffectiveCenti - oldEffectiveCenti) },
      touchAtzIds: [shift.atzId]
    };
  }

  private async applyReceiptUpsert(
    tx: Tx,
    driverId: string,
    deviceId: string,
    event: Extract<SyncEvent, { type: "receipt_upsert" }>
  ): Promise<EventOutcome> {
    const shift = await this.loadOwnShift(tx, driverId, event.shiftId);
    if ("conflict" in shift) {
      return { result: conflict(event, shift.conflict.code, shift.conflict.message) };
    }

    const [existing] = await tx
      .select()
      .from(fuelReceiptEvents)
      .where(eq(fuelReceiptEvents.id, event.id))
      .limit(1);

    if (!existing) {
      const isDeleted = event.isDeleted ?? false;
      await tx.insert(fuelReceiptEvents).values({
        id: event.id,
        shiftId: event.shiftId,
        liters: toNumeric(event.liters),
        happenedAtClient: new Date(event.happenedAtClient),
        isDeleted,
        editedAt: event.editedAt ? new Date(event.editedAt) : null,
        deviceId
      });
      return {
        result: applied(event),
        delta: { atzId: shift.atzId, centi: isDeleted ? 0 : toCenti(event.liters) },
        touchAtzIds: [shift.atzId]
      };
    }

    if (existing.shiftId !== event.shiftId) {
      return {
        result: conflict(event, "shift_mismatch", "Событие принадлежит другой смене")
      };
    }

    const lww = this.resolveLastWriteWins(event, existing.editedAt);
    if (lww !== "apply") {
      return {
        result:
          lww === "noop"
            ? applied(event)
            : conflict(event, "stale", "На сервере более новая версия события"),
        touchAtzIds: [shift.atzId]
      };
    }

    const isDeleted = event.isDeleted ?? false;
    const oldEffectiveCenti = existing.isDeleted ? 0 : numericToCenti(existing.liters);
    const newEffectiveCenti = isDeleted ? 0 : toCenti(event.liters);

    await tx.insert(eventEdits).values({
      eventId: event.id,
      eventType: "receipt",
      before: {
        liters: existing.liters,
        happenedAtClient: existing.happenedAtClient.toISOString(),
        isDeleted: existing.isDeleted,
        editedAt: existing.editedAt?.toISOString() ?? null
      },
      after: {
        liters: toNumeric(event.liters),
        happenedAtClient: event.happenedAtClient,
        isDeleted,
        editedAt: event.editedAt ?? null
      }
    });
    // ttn_photo_path / ttn_photo_status правкой НЕ затираются — фото живёт своим циклом аплоада
    await tx
      .update(fuelReceiptEvents)
      .set({
        liters: toNumeric(event.liters),
        happenedAtClient: new Date(event.happenedAtClient),
        isDeleted,
        editedAt: event.editedAt ? new Date(event.editedAt) : null
      })
      .where(eq(fuelReceiptEvents.id, event.id));

    return {
      result: applied(event),
      delta: { atzId: shift.atzId, centi: newEffectiveCenti - oldEffectiveCenti },
      touchAtzIds: [shift.atzId]
    };
  }

  /** Смена существует и принадлежит водителю (single-writer-per-shift).
   *  Статус НЕ проверяется: дозапись в закрытую смену допустима (офлайн-ретраи). */
  private async loadOwnShift(
    tx: Tx,
    driverId: string,
    shiftId: string
  ): Promise<{ atzId: string } | { conflict: { code: string; message: string } }> {
    const [shift] = await tx
      .select({ driverId: shifts.driverId, atzId: shifts.atzId })
      .from(shifts)
      .where(eq(shifts.id, shiftId))
      .limit(1);
    if (!shift) {
      return { conflict: { code: "shift_not_found", message: "Смена не найдена на сервере" } };
    }
    if (shift.driverId !== driverId) {
      return { conflict: { code: "forbidden", message: "Смена принадлежит другому водителю" } };
    }
    return { atzId: shift.atzId };
  }

  private async checkVehicleExists(
    tx: Tx,
    vehicleId: string
  ): Promise<{ code: string; message: string } | null> {
    const [vehicle] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);
    return vehicle ? null : { code: "vehicle_not_found", message: "ТС не найдено на сервере" };
  }

  /** LWW по editedAt:
   *  - входящее без editedAt — ретрай оригинала, существующую строку не перезаписывает (noop);
   *  - editedAt равен серверному — идемпотентный ретрай правки (noop);
   *  - editedAt старше серверного — клиент отстал (stale);
   *  - editedAt новее — применяем (apply). */
  private resolveLastWriteWins(
    event: { editedAt?: string | null },
    existingEditedAt: Date | null
  ): "apply" | "noop" | "stale" {
    if (!event.editedAt) {
      return "noop";
    }
    const incoming = Date.parse(event.editedAt);
    const existing = existingEditedAt?.getTime() ?? 0;
    if (incoming === existing) {
      return "noop";
    }
    return incoming < existing ? "stale" : "apply";
  }
}

export const syncService: SyncService = new DrizzleSyncService();
