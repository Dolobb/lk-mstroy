import { Pressable, Text, View } from "react-native";
import { openApkUrl } from "../hooks/useAppUpdate";

interface Props {
  apkUrl: string;
  onDismiss: () => void;
}

export function UpdateBanner({ apkUrl, onDismiss }: Props) {
  return (
    <View className="bg-primary px-4 py-3 flex-row items-center justify-between gap-3">
      <Text className="text-white text-body font-semibold flex-1">
        Доступна новая версия приложения
      </Text>
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => openApkUrl(apkUrl)}
          className="bg-white rounded-lg px-3 py-1.5"
        >
          <Text className="text-primary text-caption font-bold">Скачать</Text>
        </Pressable>
        <Pressable onPress={onDismiss} className="px-2 py-1.5">
          <Text className="text-white/70 text-caption">✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
