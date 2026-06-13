import { Pressable, Text, View } from "react-native";

export default function TokenDemoScreen() {
  return (
    <View className="flex-1 bg-surface-1 items-center justify-center gap-6 p-6">
      <Text className="text-title font-bold text-ink-1">Токены OK</Text>

      <View className="bg-canvas border border-hairline rounded-xl p-6 gap-2">
        <Text className="text-ink-1 text-body font-semibold">Основной текст</Text>
        <Text className="text-ink-2 text-body-sm">Вторичный текст на поверхности</Text>
        <Text className="text-ink-3 text-caption">Подпись с приглушенным цветом</Text>

        <View className="flex-row items-baseline gap-2">
          <Text className="text-display-2xl font-extrabold text-ink-1">1250</Text>
          <Text className="text-heading text-ink-3">Л</Text>
        </View>
      </View>

      <Pressable className="min-h-tap-primary bg-primary rounded-lg px-8 items-center justify-center">
        <Text className="text-on-primary text-subheading font-semibold">Основное действие</Text>
      </Pressable>

      <Pressable className="min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center">
        <Text className="text-ink-1 text-body-sm font-semibold">Вторичное действие</Text>
      </Pressable>

      <View className="flex-row gap-3">
        <View className="min-h-tap-min rounded-full px-4 flex-row items-center gap-2 bg-success-soft">
          <View className="w-[9px] h-[9px] rounded-full bg-success" />
          <Text className="text-body-sm font-semibold text-success">synced</Text>
        </View>

        <View className="min-h-tap-min rounded-full px-4 flex-row items-center gap-2 bg-queued-soft">
          <View className="w-[9px] h-[9px] rounded-full bg-queued" />
          <Text className="text-body-sm font-semibold text-queued">offline</Text>
        </View>

        <View className="min-h-tap-min rounded-full px-4 flex-row items-center gap-2 bg-primary-soft">
          <View className="w-[9px] h-[9px] rounded-full bg-primary" />
          <Text className="text-body-sm font-semibold text-primary">syncing</Text>
        </View>
      </View>
    </View>
  );
}
