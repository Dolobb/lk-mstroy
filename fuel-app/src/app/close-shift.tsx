import { Redirect, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAtz, useCurrentShift, useShiftEvents } from "@/hooks/queries";
import { sumPendingDelta } from "@/hooks/useAtzRemaining";
import { closeShift, type CurrentShift } from "@/sync/mutations";
import { LITERS_INPUT_STYLE } from "@/constants/inputs";

type FuelEventPayload = {
  type: "dispense_upsert" | "receipt_upsert";
  liters: number;
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

export default function CloseShiftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentShiftQuery = useCurrentShift();
  const currentShift = parseCurrentShift(currentShiftQuery.data[0]?.value);
  const [closingRemainingLiters, setClosingRemainingLiters] = useState("");
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  // Запоминаем первую валидную смену: live-query может транзиентно вернуть [] во время bootstrap.
  const shiftRef = useRef<CurrentShift | null>(null);
  if (currentShift) shiftRef.current = currentShift;
  const shift = currentShift ?? shiftRef.current;

  const atzRows = useAtz(shift?.atzId ?? null);
  const events = useShiftEvents(shift?.shiftId ?? null);
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
  const summary = useMemo(() => {
    let dispensed = 0;
    let received = 0;

    for (const { payload } of visibleEvents) {
      if (payload.type === "receipt_upsert") received += payload.liters;
      if (payload.type === "dispense_upsert") dispensed += payload.liters;
    }

    return { dispensed, received, operations: visibleEvents.length };
  }, [visibleEvents]);

  if (currentShiftQuery.updatedAt === undefined && !shift) {
    return (
      <View className="flex-1 bg-surface-1 items-center justify-center" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <ActivityIndicator color="#5e6ad2" />
      </View>
    );
  }
  if (!shift) return <Redirect href="/" />;
  const activeShift = shift;

  const atz = atzRows.data[0];
  const remaining = (atz?.remainingLiters ?? 0) + sumPendingDelta(events.data);

  async function onConfirm() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const normalized = closingRemainingLiters.trim().replace(",", ".");
      const closing = normalized.length > 0 ? Number(normalized) : undefined;
      if (closing !== undefined && (!Number.isFinite(closing) || closing < 0)) {
        Alert.alert("Проверьте остаток", "Введите неотрицательное число или оставьте поле пустым");
        return;
      }

      setBusy(true);
      await closeShift(activeShift.shiftId, closing);
      router.replace("/");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-surface-1 p-6 gap-6" style={{ paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }}>
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          className="min-w-tap-min min-h-tap-min rounded-full bg-canvas border border-hairline-strong items-center justify-center active:bg-surface-3"
        >
          <Text className="text-heading text-ink-1">‹</Text>
        </Pressable>
        <Text className="text-title font-bold text-ink-1">Закрытие смены</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4"
        contentContainerStyle={{ paddingBottom: 16 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="bg-canvas rounded-xl border border-hairline-strong p-5 gap-3">
          <Text className="text-label font-bold text-ink-3 uppercase">АТЗ</Text>
          <Text className="text-heading font-bold text-ink-1">{atz?.gosNumber ?? "—"}</Text>
          {atz?.title ? <Text className="text-caption text-ink-3">{atz.title}</Text> : null}
          <View className="flex-row items-end gap-2">
            <Text className="text-display-xl font-extrabold text-ink-1">{formatLiters(remaining)}</Text>
            <Text className="text-heading text-ink-3 mb-1">Л</Text>
          </View>
        </View>

        <View className="bg-canvas rounded-xl border border-hairline-strong p-5 gap-3">
          <Text className="text-label font-bold text-ink-3 uppercase">Итоги смены</Text>
          <View className="gap-2">
            <Text className="text-body-sm text-ink-2">Выдано: {formatLiters(summary.dispensed)} Л</Text>
            <Text className="text-body-sm text-ink-2">Получено: {formatLiters(summary.received)} Л</Text>
            <Text className="text-body-sm text-ink-2">Операций: {summary.operations}</Text>
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-label font-bold text-ink-3 uppercase">Остаток в АТЗ на конец смены</Text>
          <TextInput
            className="min-h-tap-primary px-4 rounded-md border border-hairline-strong bg-canvas text-display-2xl font-extrabold text-ink-1"
            style={LITERS_INPUT_STYLE}
            placeholder={formatLiters(remaining)}
            placeholderTextColor="#8a8f98"
            keyboardType="numeric"
            value={closingRemainingLiters}
            onChangeText={setClosingRemainingLiters}
          />
          <Text className="text-body-sm text-ink-3"> </Text>
        </View>
      </ScrollView>

      <View className="gap-3">
        <Pressable
          disabled={busy}
          onPress={() => void onConfirm()}
          className={`min-h-tap-primary rounded-lg px-8 items-center justify-center ${
            busy ? "bg-surface-4" : "bg-primary active:bg-primary-pressed"
          }`}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-subheading font-semibold text-on-primary">Подтвердить закрытие</Text>
          )}
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={() => router.back()}
          className="min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center active:bg-surface-3"
        >
          <Text className="text-ink-1 text-body-sm font-semibold">Отмена</Text>
        </Pressable>
      </View>
    </View>
  );
}
