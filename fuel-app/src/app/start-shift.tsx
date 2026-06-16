import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriverAtz } from "@/hooks/queries";
import { startShift } from "@/sync/mutations";

function formatLiters(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

export default function StartShiftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const atzRows = useDriverAtz();
  const [busyAtzId, setBusyAtzId] = useState<string | null>(null);
  const submittingRef = useRef(false);

  async function onStart(atzId: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusyAtzId(atzId);
    try {
      await startShift(atzId);
      router.replace("/work");
    } finally {
      submittingRef.current = false;
      setBusyAtzId(null);
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
        <Text className="text-title font-bold text-ink-1">Старт смены</Text>
      </View>

      <View className="gap-3">
        {atzRows.data.length === 0 ? (
          <Text className="text-body text-ink-2">Нет доступных АТЗ — обратитесь к диспетчеру</Text>
        ) : (
          atzRows.data.map((atz) => (
            <Pressable
              key={atz.id}
              disabled={busyAtzId !== null}
              onPress={() => void onStart(atz.id)}
              className="min-h-[64px] rounded-lg bg-canvas border border-hairline-strong px-4 py-3 justify-center active:bg-surface-3"
            >
              <View className="flex-row items-center justify-between gap-4">
                <View className="gap-1 flex-1">
                  <Text className="text-subheading font-bold text-ink-1">{atz.gosNumber}</Text>
                  <Text className="text-caption text-ink-3">
                    Остаток: {formatLiters(atz.remainingLiters)} Л{atz.title ? ` · ${atz.title}` : ""}
                  </Text>
                </View>
                {busyAtzId === atz.id ? <ActivityIndicator /> : null}
              </View>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}
