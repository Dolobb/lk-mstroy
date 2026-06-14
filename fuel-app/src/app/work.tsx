import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { useAtz, useCurrentShift, useShiftEvents, useVehiclesByIds } from "@/hooks/queries";
import { sumPendingDelta } from "@/hooks/useAtzRemaining";
import { useSync } from "@/hooks/useSync";
import { closeShift, type CurrentShift, editEvent, softDeleteEvent } from "@/sync/mutations";
import { type SyncUiState, useSyncStatusStore } from "@/stores/sync-status";

type FuelEventPayload = {
  type: "dispense_upsert" | "receipt_upsert";
  liters: number;
  vehicleId?: string;
  happenedAtClient?: string;
  isDeleted?: boolean;
};

function parseCurrentShift(value: string | undefined): CurrentShift | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as CurrentShift;
  } catch {
    return null;
  }
}

function parseFuelEvent(payload: string): FuelEventPayload | null {
  try {
    return JSON.parse(payload) as FuelEventPayload;
  } catch {
    return null;
  }
}

function formatLiters(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value = new Date().toISOString()) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function SyncPill({ state, pending }: { state: SyncUiState; pending: number }) {
  const tone =
    state === "error"
      ? "bg-error-soft text-error"
      : state === "syncing"
        ? "bg-primary-soft text-primary"
        : state === "queued"
          ? "bg-queued-soft text-queued"
          : "bg-success-soft text-success";
  const dot =
    state === "error" ? "bg-error" : state === "syncing" ? "bg-primary" : state === "queued" ? "bg-queued" : "bg-success";
  const label =
    state === "error"
      ? "Ошибка"
      : state === "syncing"
        ? "Синк"
        : state === "queued"
          ? `Очередь ${pending}`
          : "Готово";

  return (
    <View className={`min-h-tap-min rounded-full px-4 flex-row items-center gap-2 ${tone}`}>
      <View className={`w-[9px] h-[9px] rounded-full ${dot}`} />
      <Text className="text-caption font-semibold">{label}</Text>
    </View>
  );
}

function BigAction({
  title,
  caption,
  icon,
  primary,
  onPress,
}: {
  title: string;
  caption: string;
  icon: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`min-h-[116px] rounded-xl p-5 gap-3 justify-center active:bg-surface-3 ${
        primary ? "bg-primary" : "bg-canvas border border-hairline-strong"
      }`}
    >
      <Text className={primary ? "text-on-primary" : "text-ink-1"} style={{ fontSize: 44, lineHeight: 48 }}>
        {icon}
      </Text>
      <View className="gap-1">
        <Text className={`text-heading font-bold ${primary ? "text-on-primary" : "text-ink-1"}`}>{title}</Text>
        <Text className={`text-caption ${primary ? "text-on-primary" : "text-ink-3"}`}>{caption}</Text>
      </View>
    </Pressable>
  );
}

export default function WorkScreen() {
  const router = useRouter();
  const sheetRef = useRef<BottomSheetModal>(null);
  const syncState = useSyncStatusStore((s) => s.state);
  const pending = useSyncStatusStore((s) => s.pending);
  const lastError = useSyncStatusStore((s) => s.lastError);
  const { sync } = useSync();
  const currentShiftQuery = useCurrentShift();
  const currentShift = parseCurrentShift(currentShiftQuery.data[0]?.value);
  const [editing, setEditing] = useState<{ id: string; type: "dispense_upsert" | "receipt_upsert"; liters: number } | null>(
    null,
  );
  const [editLiters, setEditLiters] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const editLitersNumber = useMemo(() => Number(editLiters.replace(",", ".")), [editLiters]);
  const validEditLiters = Number.isFinite(editLitersNumber) && editLitersNumber > 0;
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />,
    [],
  );
  // Запоминаем первую валидную смену: фоновый bootstrap (раз в 60с) штормит change-listener'ы,
  // и live-query может транзиентно вернуть [] → не выкидываем с рабочего экрана. Смена локально
  // удаляется только при закрытии (там навигация на "/" явная), так что ссылка безопасна.
  const shiftRef = useRef<CurrentShift | null>(null);
  if (currentShift) shiftRef.current = currentShift;
  const shift = currentShift ?? shiftRef.current;
  const atzRows = useAtz(shift?.atzId ?? null);
  const events = useShiftEvents(shift?.shiftId ?? null);
  // ВСЕ хуки — ДО ранних return'ов (Rules of Hooks): на маунте экран проходит
  // loading→loaded, и хуки после return'а меняли бы их число между рендерами
  // → «Rendered more hooks than during the previous render». Зависят только от events.
  const visibleEvents = useMemo(
    () =>
      events.data
        .map((row) => ({ row, payload: parseFuelEvent(row.payload) }))
        .filter(
          (item): item is { row: (typeof events.data)[number]; payload: FuelEventPayload } =>
            item.payload !== null && item.payload.isDeleted !== true,
        ),
    [events.data],
  );
  const dispenseVehicleIds = useMemo(
    () =>
      visibleEvents
        .filter(({ payload }) => payload.type === "dispense_upsert" && Boolean(payload.vehicleId))
        .map(({ payload }) => payload.vehicleId as string),
    [visibleEvents],
  );
  const dispenseVehicles = useVehiclesByIds(dispenseVehicleIds);
  const vehicleGosById = useMemo(
    () => new Map(dispenseVehicles.data.map((vehicle) => [vehicle.id, vehicle.gosNumber])),
    [dispenseVehicles.data],
  );

  // useLiveQuery на маунте отдаёт [] (updatedAt undefined) до первого чтения кэша.
  // Без этой проверки редирект срабатывает до загрузки → redirect-loop с /main.
  if (currentShiftQuery.updatedAt === undefined && !shift) {
    return (
      <View className="flex-1 bg-surface-1 items-center justify-center">
        <ActivityIndicator color="#5e6ad2" />
      </View>
    );
  }
  if (!shift) return <Redirect href="/" />;
  const activeShift = shift;

  const atz = atzRows.data[0];
  // Остаток = серверное «последнее известное» + локальные несинхронизированные дельты (Shift-Model).
  const remaining = (atz?.remainingLiters ?? 0) + sumPendingDelta(events.data);

  async function onSaveEdit() {
    if (!editing || !validEditLiters) {
      Alert.alert("Проверьте литры", "Введите количество больше 0");
      return;
    }
    setEditBusy(true);
    try {
      await editEvent(editing.id, { liters: editLitersNumber });
      sheetRef.current?.dismiss();
      setEditing(null);
    } finally {
      setEditBusy(false);
    }
  }

  function onDeleteEdit() {
    if (!editing) return;
    Alert.alert("Удалить операцию?", "Операция будет помечена удалённой и уйдёт в синк.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          setEditBusy(true);
          try {
            await softDeleteEvent(editing.id);
            sheetRef.current?.dismiss();
            setEditing(null);
          } finally {
            setEditBusy(false);
          }
        },
      },
    ]);
  }

  async function onCloseShift() {
    await closeShift(activeShift.shiftId);
    router.replace("/");
  }

  return (
    <View className="flex-1 bg-surface-1 p-6 gap-5">
      <View className="flex-row items-start justify-between gap-4">
        <View className="gap-1 flex-1">
          <Text className="text-label font-bold text-success uppercase">В РАБОТЕ</Text>
          <Text className="text-heading font-bold text-ink-1">{formatDate()}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <SyncPill state={syncState} pending={pending} />
          <Pressable
            onPress={() => void sync()}
            className="min-h-tap-min rounded-full px-4 bg-canvas border border-hairline-strong items-center justify-center active:bg-surface-3"
          >
            <Text className="text-caption font-semibold text-ink-1">Обновить</Text>
          </Pressable>
        </View>
      </View>

      {syncState === "error" && lastError ? (
        <View className="bg-error-soft rounded-lg px-4 py-2">
          <Text className="text-caption text-error" numberOfLines={3}>
            Синк: {lastError}
          </Text>
        </View>
      ) : null}

      <View className="bg-canvas rounded-xl border border-hairline-strong p-5 gap-3">
        <Text className="text-label font-bold text-ink-3 uppercase">АТЗ</Text>
        <Text className="text-heading font-bold text-ink-1">{atz?.gosNumber ?? "—"}</Text>
        {atz?.title ? <Text className="text-caption text-ink-3">{atz.title}</Text> : null}
        <View className="flex-row items-end gap-2">
          <Text className="text-display-2xl font-extrabold text-ink-1">{formatLiters(remaining)}</Text>
          <Text className="text-heading text-ink-3 mb-2">Л</Text>
        </View>
      </View>

      <View className="flex-row gap-4">
        <View className="flex-1">
          <BigAction title="Передача топлива" caption="Заправить технику" icon="↓" primary onPress={() => router.push("/dispense")} />
        </View>
        <View className="flex-1">
          <BigAction
            title="Получение топлива"
            caption="Принять топливо в АТЗ"
            icon="↑"
            onPress={() => router.push("/receipt")}
          />
        </View>
      </View>

      <View className="flex-1 gap-2">
        <Text className="text-label font-bold text-ink-3 uppercase">Операции смены</Text>
        {visibleEvents.length === 0 ? (
          <View className="min-h-[68px] rounded-lg bg-canvas border border-hairline px-4 justify-center">
            <Text className="text-body-sm text-ink-3">Записей пока нет</Text>
          </View>
        ) : (
          visibleEvents.map(({ row, payload }) => {
            const receipt = payload.type === "receipt_upsert";
            const operationLabel = receipt
              ? "Получение"
              : `Выдача · ${payload.vehicleId ? (vehicleGosById.get(payload.vehicleId) ?? "ТС …") : "ТС …"}`;
            return (
              <View key={row.id} className="min-h-[68px] rounded-lg bg-canvas border border-hairline flex-row overflow-hidden">
                <View className={`w-[6px] ${receipt ? "bg-success" : "bg-primary"}`} />
                <View className="flex-1 px-4 py-3 justify-center gap-1">
                  <Text className={`text-heading font-bold ${receipt ? "text-success" : "text-ink-1"}`}>
                    {receipt ? "+" : ""}
                    {formatLiters(payload.liters)} Л
                  </Text>
                  <Text className="text-caption text-ink-3">
                    {operationLabel} · {formatTime(row.happenedAtClient ?? payload.happenedAtClient)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setEditing({ id: row.id, type: payload.type, liters: payload.liters });
                    setEditLiters(String(payload.liters));
                    sheetRef.current?.present();
                  }}
                  className="min-w-tap-min min-h-tap-min items-center justify-center active:bg-surface-3"
                >
                  <Text className="text-heading text-ink-3">✎</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>

      <Pressable
        onPress={() => void onCloseShift()}
        className="min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center active:bg-surface-3"
      >
        <Text className="text-ink-1 text-body-sm font-semibold">Закрыть смену</Text>
      </Pressable>

      <BottomSheetModal
        ref={sheetRef}
        enableDynamicSizing
        backdropComponent={renderBackdrop}
        onDismiss={() => {
          setEditing(null);
          setEditLiters("");
        }}
      >
        <BottomSheetView style={{ paddingHorizontal: 24, paddingBottom: 32, gap: 16 }}>
          <View className="gap-1">
            <Text className="text-title font-bold text-ink-1">
              {editing?.type === "receipt_upsert" ? "Правка получения" : "Правка выдачи"}
            </Text>
            <Text className="text-caption text-ink-3">Изменение сохранится как правка этой операции.</Text>
          </View>

          <View className="gap-2">
            <Text className="text-label font-bold text-ink-3 uppercase">Литры</Text>
            <BottomSheetTextInput
              className={`min-h-tap-primary px-4 rounded-md border bg-canvas text-display-2xl font-extrabold text-ink-1 ${
                editLiters.length > 0 && !validEditLiters ? "border-error" : "border-hairline-strong"
              }`}
              placeholder="0"
              placeholderTextColor="#8a8f98"
              keyboardType="numeric"
              value={editLiters}
              onChangeText={setEditLiters}
            />
            <Text className={`text-body-sm ${editLiters.length > 0 && !validEditLiters ? "text-error" : "text-ink-3"}`}>
              {editLiters.length > 0 && !validEditLiters ? "Введите количество больше 0" : " "}
            </Text>
          </View>

          <Pressable
            disabled={editBusy || !validEditLiters}
            onPress={() => void onSaveEdit()}
            className={`min-h-tap-primary rounded-lg px-8 items-center justify-center ${
              editBusy || !validEditLiters ? "bg-surface-4" : "bg-primary active:bg-primary-pressed"
            }`}
          >
            {editBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className={`text-subheading font-semibold ${validEditLiters ? "text-on-primary" : "text-ink-3"}`}>
                Сохранить
              </Text>
            )}
          </Pressable>

          <Pressable
            disabled={editBusy || !editing}
            onPress={onDeleteEdit}
            className="min-h-tap-secondary rounded-lg px-6 bg-error-soft items-center justify-center active:bg-surface-3"
          >
            <Text className="text-body-sm font-semibold text-error">Удалить операцию</Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}
