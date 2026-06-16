import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/useAuth";
import { useCurrentShift } from "@/hooks/queries";
import { useSessionStore } from "@/stores/session";
import { type SyncUiState, useSyncStatusStore } from "@/stores/sync-status";

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
      ? "Ошибка синка"
      : state === "syncing"
        ? "Синхронизация"
        : state === "queued"
          ? `В очереди: ${pending}`
          : "Синхронизировано";

  return (
    <View className={`min-h-tap-min rounded-full px-4 flex-row items-center gap-2 ${tone}`}>
      <View className={`w-[9px] h-[9px] rounded-full ${dot}`} />
      <Text className="text-caption font-semibold">{label}</Text>
    </View>
  );
}

export default function MainScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const driver = useSessionStore((s) => s.driver);
  const syncState = useSyncStatusStore((s) => s.state);
  const pending = useSyncStatusStore((s) => s.pending);
  const { logout } = useAuth();
  const currentShift = useCurrentShift();

  useEffect(() => {
    if (currentShift.data[0]?.value) router.replace("/work");
  }, [currentShift.data, router]);

  return (
    <View className="flex-1 bg-surface-1 p-6 gap-8 justify-between" style={{ paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }}>
      <View className="gap-8">
        <View className="flex-row items-start justify-between gap-4">
          <View className="gap-1 flex-1">
            <Text className="text-label font-bold text-ink-3 uppercase">ВОДИТЕЛЬ</Text>
            <Text className="text-title font-bold text-ink-1">{driver?.fullName ?? "—"}</Text>
            <Text className="text-body text-ink-2">Смена не начата</Text>
          </View>
          <SyncPill state={syncState} pending={pending} />
        </View>

        <View className="gap-4">
          <Pressable
            onPress={() => router.push("/start-shift")}
            className="min-h-tap-primary bg-primary rounded-lg px-8 items-center justify-center active:bg-primary-pressed"
          >
            <Text className="text-on-primary text-subheading font-semibold">Начать смену</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/profile")}
            className="min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center active:bg-surface-3"
          >
            <Text className="text-ink-1 text-body-sm font-semibold">Профиль и история</Text>
          </Pressable>
        </View>
      </View>

      <Pressable onPress={() => void logout()} className="min-h-tap-secondary items-center justify-center px-6">
        <Text className="text-ink-3 text-body-sm">Выйти</Text>
      </Pressable>
    </View>
  );
}
