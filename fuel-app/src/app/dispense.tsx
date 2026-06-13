import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { useCurrentShift, useVehicleSearch } from "@/hooks/queries";
import { addDispense, type CurrentShift } from "@/sync/mutations";

type VehicleRow = ReturnType<typeof useVehicleSearch>["data"][number];

function parseCurrentShift(value: string | undefined): CurrentShift | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as CurrentShift;
  } catch {
    return null;
  }
}

export default function DispenseScreen() {
  const router = useRouter();
  const currentShift = parseCurrentShift(useCurrentShift().data[0]?.value);
  const [query, setQuery] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRow | null>(null);
  const [liters, setLiters] = useState("");
  const [busy, setBusy] = useState(false);
  const vehicles = useVehicleSearch(query);
  const litersNumber = useMemo(() => Number(liters.replace(",", ".")), [liters]);
  const validLiters = Number.isFinite(litersNumber) && litersNumber > 0;

  if (!currentShift) return <Redirect href="/" />;
  const shift = currentShift;

  async function submit() {
    if (!selectedVehicle || !validLiters) {
      Alert.alert("Проверьте литры", "Введите количество больше 0");
      return;
    }
    setBusy(true);
    try {
      await addDispense(shift.shiftId, selectedVehicle.id, litersNumber);
      router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-surface-1 p-6 gap-5">
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          className="min-w-tap-min min-h-tap-min rounded-full bg-canvas border border-hairline-strong items-center justify-center active:bg-surface-3"
        >
          <Text className="text-heading text-ink-1">‹</Text>
        </Pressable>
        <Text className="text-title font-bold text-ink-1">Передача топлива</Text>
      </View>

      <View className="gap-3">
        <TextInput
          className="min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
          placeholder="Поиск по госномеру"
          autoCapitalize="characters"
          autoCorrect={false}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setSelectedVehicle(null);
          }}
        />

        {/* TODO 3.4: добавить группировку по организациям и org-section-header. */}
        <View className="gap-2">
          {vehicles.data.map((vehicle) => {
            const selected = selectedVehicle?.id === vehicle.id;
            return (
              <Pressable
                key={vehicle.id}
                onPress={() => setSelectedVehicle(vehicle)}
                className={`min-h-[64px] rounded-lg bg-canvas border px-4 py-3 justify-center active:bg-surface-3 ${
                  selected ? "border-primary" : "border-hairline-strong"
                }`}
              >
                <Text className="text-subheading font-bold text-ink-1">{vehicle.gosNumber}</Text>
                <Text className="text-caption text-ink-3">
                  {[vehicle.mark, vehicle.vehicleType].filter(Boolean).join(" · ") || "Без описания"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        onPress={() => Alert.alert("Скоро", "Добавление ТС — след. заход")}
        className="min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center active:bg-surface-3"
      >
        <Text className="text-ink-1 text-body-sm font-semibold">+ добавить ТС</Text>
      </Pressable>

      {selectedVehicle ? (
        <View className="mt-auto gap-4 bg-canvas rounded-xl border border-hairline-strong p-5">
          <View className="gap-1">
            <Text className="text-label font-bold text-ink-3 uppercase">ВЫБРАНО ТС</Text>
            <Text className="text-heading font-bold text-ink-1">{selectedVehicle.gosNumber}</Text>
          </View>
          <TextInput
            className="min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
            placeholder="Литры"
            keyboardType="numeric"
            value={liters}
            onChangeText={setLiters}
          />
          <Pressable
            disabled={busy || !validLiters}
            onPress={() => void submit()}
            className={`min-h-tap-primary rounded-lg px-8 items-center justify-center ${
              busy || !validLiters ? "bg-surface-4" : "bg-primary active:bg-primary-pressed"
            }`}
          >
            <Text className={`text-subheading font-semibold ${busy || !validLiters ? "text-ink-3" : "text-on-primary"}`}>
              Записать
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
