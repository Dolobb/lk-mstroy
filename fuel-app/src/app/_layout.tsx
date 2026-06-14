import "@/global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useDbMigrations } from "@/db/client";
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

  // GestureHandlerRootView + BottomSheetModalProvider — нужны для @gorhom/bottom-sheet
  // (правка операции). Оборачиваем весь рендер, включая loading-состояния.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>{content}</BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
