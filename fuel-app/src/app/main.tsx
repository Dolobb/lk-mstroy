import { Pressable, Text, View } from "react-native";

import { useAuth } from "@/hooks/useAuth";
import { useSessionStore } from "@/stores/session";

/**
 * Главный экран (смена не начата) — пока заглушка среза 3.4.
 * TODO: «Начать смену» → выбор АТЗ; «Профиль и история»; индикатор синка в шапке.
 */
export default function MainScreen() {
  const driver = useSessionStore((s) => s.driver);
  const { logout } = useAuth();

  return (
    <View className="flex-1 bg-surface-1 p-6 gap-6 justify-center">
      <View className="gap-1">
        <Text className="text-label text-ink-3">ВОДИТЕЛЬ</Text>
        <Text className="text-title font-bold text-ink-1">{driver?.fullName ?? "—"}</Text>
      </View>

      <Text className="text-body text-ink-2">Смена не начата</Text>

      <Pressable className="min-h-tap-primary bg-primary rounded-lg px-8 items-center justify-center">
        <Text className="text-on-primary text-subheading font-semibold">Начать смену</Text>
      </Pressable>

      <Pressable className="min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center">
        <Text className="text-ink-1 text-body-sm font-semibold">Профиль и история</Text>
      </Pressable>

      <Pressable
        onPress={() => void logout()}
        className="min-h-tap-secondary items-center justify-center px-6"
      >
        <Text className="text-ink-3 text-body-sm">Выйти</Text>
      </Pressable>
    </View>
  );
}
