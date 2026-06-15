import "@/global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { UpdateBanner } from "@/components/UpdateBanner";
import { useDbMigrations } from "@/db/client";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { useAuth } from "@/hooks/useAuth";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useSessionStore } from "@/stores/session";

export default function RootLayout() {
  const migrations = useDbMigrations();
  const status = useSessionStore((s) => s.status);
  const { restore } = useAuth();

  // После применения миграций — восстановить сессию из secure-store.
  useEffect(() => {
    if (migrations.success) void restore();
  }, [migrations.success, restore]);

  // Авто-синк при активной сессии: первичный bootstrap подтянет АТЗ/ТС в локальный кэш.
  useAutoSync(status === "active");

  const update = useAppUpdate();

  let content: React.ReactNode;
  if (migrations.error) {
    content = (
      <View className="flex-1 bg-surface-1 items-center justify-center p-6">
        <Text className="text-body text-error">Ошибка БД: {migrations.error.message}</Text>
      </View>
    );
  } else if (!migrations.success || status === "loading") {
    content = (
      <View className="flex-1 bg-surface-1 items-center justify-center">
        <ActivityIndicator color="#5e6ad2" />
      </View>
    );
  } else {
    content = <Stack screenOptions={{ headerShown: false }} />;
  }

  // SafeAreaProvider — инсеты системных панелей (Android рисует edge-to-edge: нижняя навигация
  // наплывала на кнопки). GestureHandlerRootView + BottomSheetModalProvider — для @gorhom/bottom-sheet.
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
          <View style={{ flex: 1 }}>
            {update.available && update.apkUrl && (
              <UpdateBanner apkUrl={update.apkUrl} onDismiss={update.dismiss} />
            )}
            {content}
          </View>
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
