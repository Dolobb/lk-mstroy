import { Redirect, useRouter } from "expo-router";
import { Alert, Pressable, Text, View } from "react-native";

import { useAtz, useCurrentShift, useShiftEvents } from "@/hooks/queries";
import { useSync } from "@/hooks/useSync";
import { closeShift, type CurrentShift } from "@/sync/mutations";
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
  const syncState = useSyncStatusStore((s) => s.state);
  const pending = useSyncStatusStore((s) => s.pending);
  const { sync } = useSync();
  const currentShift = parseCurrentShift(useCurrentShift().data[0]?.value);
  const atzRows = useAtz(currentShift?.atzId ?? null);
  const events = useShiftEvents(currentShift?.shiftId ?? null);

  if (!currentShift) return <Redirect href="/" />;
  const shift = currentShift;

  const atz = atzRows.data[0];
  const visibleEvents = events.data
    .map((row) => ({ row, payload: parseFuelEvent(row.payload) }))
    .filter((item): item is { row: (typeof events.data)[number]; payload: FuelEventPayload } => item.payload !== null && item.payload.isDeleted !== true);

  async function onCloseShift() {
    await closeShift(shift.shiftId);
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

      <View className="bg-canvas rounded-xl border border-hairline-strong p-5 gap-3">
        <Text className="text-label font-bold text-ink-3 uppercase">АТЗ</Text>
        <Text className="text-heading font-bold text-ink-1">{atz?.gosNumber ?? "—"}</Text>
        {atz?.title ? <Text className="text-caption text-ink-3">{atz.title}</Text> : null}
        <View className="flex-row items-end gap-2">
          <Text className="text-display-2xl font-extrabold text-ink-1">{formatLiters(atz?.remainingLiters ?? 0)}</Text>
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
            onPress={() => Alert.alert("Скоро", "Экран получения — след. заход")}
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
            return (
              <View key={row.id} className="min-h-[68px] rounded-lg bg-canvas border border-hairline flex-row overflow-hidden">
                <View className={`w-[6px] ${receipt ? "bg-success" : "bg-primary"}`} />
                <View className="flex-1 px-4 py-3 justify-center gap-1">
                  <Text className={`text-heading font-bold ${receipt ? "text-success" : "text-ink-1"}`}>
                    {receipt ? "+" : ""}
                    {formatLiters(payload.liters)} Л
                  </Text>
                  <Text className="text-caption text-ink-3">
                    {receipt ? "Получение" : "Выдача"} · {formatTime(row.happenedAtClient ?? payload.happenedAtClient)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => Alert.alert("Скоро", "Правка операции — след. заход")}
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
    </View>
  );
}
