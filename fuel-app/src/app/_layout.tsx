import "@/global.css";

import { Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useDbMigrations } from "@/db/client";
import { useAuth } from "@/hooks/useAuth";
import { useSessionStore } from "@/stores/session";

export default function RootLayout() {
  const migrations = useDbMigrations();
  const status = useSessionStore((s) => s.status);
  const { restore } = useAuth();

  // После применения миграций — восстановить сессию из secure-store.
  useEffect(() => {
    if (migrations.success) void restore();
  }, [migrations.success, restore]);

  if (migrations.error) {
    return (
      <View className="flex-1 bg-surface-1 items-center justify-center p-6">
        <Text className="text-body text-error">Ошибка БД: {migrations.error.message}</Text>
      </View>
    );
  }

  if (!migrations.success || status === "loading") {
    return (
      <View className="flex-1 bg-surface-1 items-center justify-center">
        <ActivityIndicator color="#5e6ad2" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
