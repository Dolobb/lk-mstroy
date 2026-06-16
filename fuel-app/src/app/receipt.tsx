import * as ImagePicker from "expo-image-picker";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCurrentShift } from "@/hooks/queries";
import { addReceipt, type CurrentShift } from "@/sync/mutations";
import { LITERS_INPUT_STYLE } from "@/constants/inputs";

function parseCurrentShift(value: string | undefined): CurrentShift | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as CurrentShift;
  } catch {
    return null;
  }
}

export default function ReceiptScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentShiftQuery = useCurrentShift();
  const currentShift = parseCurrentShift(currentShiftQuery.data[0]?.value);
  const [liters, setLiters] = useState("");
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const litersNumber = useMemo(() => Number(liters.replace(",", ".")), [liters]);
  const validLiters = Number.isFinite(litersNumber) && litersNumber > 0;

  // Запоминаем первую валидную смену: фоновый bootstrap (раз в 60с) штормит change-listener'ы,
  // и live-query может транзиентно вернуть []. Без этого пользователя выкидывало с экрана
  // ввода на главную посреди заполнения. Смена локально удаляется только при закрытии (work).
  const shiftRef = useRef<CurrentShift | null>(null);
  if (currentShift) shiftRef.current = currentShift;
  const shift = currentShift ?? shiftRef.current;

  // useLiveQuery на маунте отдаёт [] (updatedAt undefined) до первого чтения кэша.
  if (currentShiftQuery.updatedAt === undefined && !shift) {
    return (
      <View className="flex-1 bg-surface-1 items-center justify-center" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <ActivityIndicator color="#5e6ad2" />
      </View>
    );
  }
  if (!shift) return <Redirect href="/" />;

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Нет доступа к камере", "Разрешите доступ к камере, чтобы сфотографировать ТТН");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!result.canceled) {
      setPhotoUri(result.assets[0]?.uri);
    }
  }

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      if (!shift || !validLiters) {
        Alert.alert("Проверьте литры", "Введите количество больше 0");
        return;
      }

      setBusy(true);
      await addReceipt(shift.shiftId, litersNumber, photoUri);
      router.back();
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
          className="min-h-tap-min rounded-full bg-canvas border border-hairline-strong px-4 items-center justify-center active:bg-surface-3"
        >
          <Text className="text-body-sm font-semibold text-ink-1">‹ назад</Text>
        </Pressable>
        <Text className="text-title font-bold text-ink-1">Получение топлива</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 pb-4"
        contentContainerStyle={{ paddingBottom: 16 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <Text className="text-label font-bold text-ink-3 uppercase">Литры</Text>
          <TextInput
            className="min-h-tap-primary px-4 rounded-md border border-hairline-strong bg-canvas text-display-2xl font-extrabold text-ink-1"
            style={LITERS_INPUT_STYLE}
            placeholder="0"
            placeholderTextColor="#8a8f98"
            keyboardType="numeric"
            autoFocus
            value={liters}
            onChangeText={(value) => setLiters(value.replace(",", "."))}
          />
          <Text className="text-body-sm text-ink-3">
            {liters.length > 0 && !validLiters ? "Введите количество больше 0" : " "}
          </Text>
        </View>

        <View className="gap-3 bg-canvas rounded-xl border border-hairline-strong p-5">
          <View className="gap-1">
            <Text className="text-label font-bold text-ink-3 uppercase">Фото ТТН</Text>
            <Text className="text-body-sm text-ink-3">Опционально</Text>
          </View>

          {photoUri ? (
            <View className="gap-3">
              <Image source={{ uri: photoUri }} style={{ width: "100%", height: 260, borderRadius: 12 }} />
              <View className="flex-row gap-3">
                <Pressable
                  onPress={() => void takePhoto()}
                  className="flex-1 min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center active:bg-surface-3"
                >
                  <Text className="text-ink-1 text-body-sm font-semibold">Переснять</Text>
                </Pressable>
                <Pressable
                  onPress={() => setPhotoUri(undefined)}
                  className="flex-1 min-h-tap-secondary bg-surface-3 border border-hairline rounded-lg px-6 items-center justify-center active:bg-surface-4"
                >
                  <Text className="text-ink-1 text-body-sm font-semibold">Убрать фото</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => void takePhoto()}
              className="min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center active:bg-surface-3"
            >
              <Text className="text-ink-1 text-body-sm font-semibold">Сфотографировать ТТН</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      <Pressable
        disabled={busy || !validLiters}
        onPress={() => void submit()}
        className={`min-h-tap-primary rounded-lg px-8 items-center justify-center ${
          busy || !validLiters ? "bg-surface-4" : "bg-primary active:bg-primary-pressed"
        }`}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className={`text-subheading font-semibold ${validLiters ? "text-on-primary" : "text-ink-3"}`}>
            Записать получение
          </Text>
        )}
      </Pressable>
    </View>
  );
}
