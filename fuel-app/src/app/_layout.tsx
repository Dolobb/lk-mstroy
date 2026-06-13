import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Text, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { useDbMigrations } from '@/db/client';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const migrations = useDbMigrations();

  if (migrations.error) {
    return <Text>Ошибка подготовки БД: {migrations.error.message}</Text>;
  }

  if (!migrations.success) {
    return <Text>Подготовка БД...</Text>;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
