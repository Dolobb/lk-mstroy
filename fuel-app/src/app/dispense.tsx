import { Redirect, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCurrentShift, useOrganizations, useRecentDispenses, useVehicleSearch, useVehiclesByIds } from "@/hooks/queries";
import { useAtzRemaining } from "@/hooks/useAtzRemaining";
import { addDispense, type CurrentShift } from "@/sync/mutations";
import { LITERS_INPUT_STYLE } from "@/constants/inputs";

type VehicleRow = ReturnType<typeof useVehicleSearch>["data"][number];
type VehicleSection = {
  key: string;
  title: string;
  vehicles: VehicleRow[];
};
type RecentDispensePayload = {
  vehicleId?: string;
  isDeleted?: boolean;
};

function formatLiters(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function parseCurrentShift(value: string | undefined): CurrentShift | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as CurrentShift;
  } catch {
    return null;
  }
}

function parseRecentDispense(payload: string): RecentDispensePayload | null {
  try {
    return JSON.parse(payload) as RecentDispensePayload;
  } catch {
    return null;
  }
}

export default function DispenseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentShiftQuery = useCurrentShift();
  const currentShift = parseCurrentShift(currentShiftQuery.data[0]?.value);
  const [query, setQuery] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRow | null>(null);
  const [liters, setLiters] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const vehicles = useVehicleSearch(query);
  const recentDispenses = useRecentDispenses();
  const organizations = useOrganizations();
  const organizationNameById = useMemo(
    () => new Map(organizations.data.map((organization) => [organization.id, organization.name])),
    [organizations.data],
  );
  const recentVehicleIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();

    for (const row of recentDispenses.data) {
      const payload = parseRecentDispense(row.payload);
      if (!payload?.vehicleId || payload.isDeleted === true || seen.has(payload.vehicleId)) continue;
      seen.add(payload.vehicleId);
      ids.push(payload.vehicleId);
      if (ids.length >= 8) break;
    }

    return ids;
  }, [recentDispenses.data]);
  const recentVehiclesQuery = useVehiclesByIds(recentVehicleIds);
  const recentVehicles = useMemo(() => {
    const byId = new Map(recentVehiclesQuery.data.map((vehicle) => [vehicle.id, vehicle]));
    return recentVehicleIds.flatMap((id) => {
      const vehicle = byId.get(id);
      return vehicle ? [vehicle] : [];
    });
  }, [recentVehicleIds, recentVehiclesQuery.data]);
  const vehicleSections = useMemo(() => {
    const sections = new Map<string, VehicleSection>();

    for (const vehicle of vehicles.data) {
      const organizationName = vehicle.organizationId ? organizationNameById.get(vehicle.organizationId) : undefined;
      const sectionKey = organizationName && vehicle.organizationId ? vehicle.organizationId : "__without_organization__";
      const title = organizationName ?? "Без организации";
      const section = sections.get(sectionKey) ?? { key: sectionKey, title, vehicles: [] };

      section.vehicles.push(vehicle);
      sections.set(sectionKey, section);
    }

    return Array.from(sections.values()).sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }, [organizationNameById, vehicles.data]);
  const litersNumber = useMemo(() => Number(liters.replace(",", ".")), [liters]);
  const validLiters = Number.isFinite(litersNumber) && litersNumber > 0;

  // Запоминаем первую валидную смену: фоновый bootstrap (раз в 60с) штормит change-listener'ы,
  // и live-query может транзиентно вернуть []. Без этого пользователя выкидывало с экрана
  // ввода на главную посреди заполнения. Смена локально удаляется только при закрытии (work).
  const shiftRef = useRef<CurrentShift | null>(null);
  if (currentShift) shiftRef.current = currentShift;
  const shift = currentShift ?? shiftRef.current;

  // Доступный остаток АТЗ (серверный + локальные дельты) — для проверки «нельзя выдать больше, чем в баке».
  const { remaining: available } = useAtzRemaining(shift?.atzId ?? null, shift?.shiftId ?? null);
  const exceedsTank = validLiters && litersNumber > available;
  const recipientValid = recipientName.trim().length > 0;
  const canSubmit = validLiters && !exceedsTank && recipientValid;

  // useLiveQuery на маунте отдаёт [] (updatedAt undefined) до первого чтения кэша.
  if (currentShiftQuery.updatedAt === undefined && !shift) {
    return (
      <View className="flex-1 bg-surface-1 items-center justify-center" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <ActivityIndicator color="#5e6ad2" />
      </View>
    );
  }
  if (!shift) return <Redirect href="/" />;

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      if (!shift || !selectedVehicle || !validLiters) {
        Alert.alert("Проверьте литры", "Введите количество больше 0");
        return;
      }
      if (!recipientValid) {
        Alert.alert("Укажите получателя", "Введите Фамилию И.О. получателя топлива");
        return;
      }
      if (litersNumber > available) {
        Alert.alert("Недостаточно топлива", `В баке доступно ${formatLiters(available)} Л`);
        return;
      }
      setBusy(true);
      await addDispense(shift.shiftId, selectedVehicle.id, litersNumber, recipientName);
      router.back();
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  // Фаза «ввод литров» — отдельный экран после выбора ТС (панель не уезжает за край списка).
  if (selectedVehicle) {
    return (
      <View className="flex-1 bg-surface-1 p-6 gap-6" style={{ paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }}>
        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={() => {
              setSelectedVehicle(null);
              setLiters("");
              setRecipientName("");
            }}
            className="min-w-tap-min min-h-tap-min rounded-full bg-canvas border border-hairline-strong items-center justify-center active:bg-surface-3"
          >
            <Text className="text-heading text-ink-1">‹</Text>
          </Pressable>
          <Text className="text-title font-bold text-ink-1">Выдача топлива</Text>
        </View>

        <View className="gap-1 bg-canvas rounded-xl border border-hairline-strong p-5">
          <Text className="text-label font-bold text-ink-3 uppercase">ТС</Text>
          <Text className="text-heading font-bold text-ink-1">{selectedVehicle.gosNumber}</Text>
          <Text className="text-caption text-ink-3">
            {[selectedVehicle.mark, selectedVehicle.vehicleType].filter(Boolean).join(" · ") || "Без описания"}
          </Text>
        </View>

        <View className="gap-2">
          <View className="flex-row items-baseline justify-between">
            <Text className="text-label font-bold text-ink-3 uppercase">Литры</Text>
            <Text className={`text-caption font-semibold ${exceedsTank ? "text-error" : "text-ink-3"}`}>
              Доступно: {formatLiters(available)} Л
            </Text>
          </View>
          <TextInput
            className={`min-h-tap-primary px-4 rounded-md border bg-canvas text-display-2xl font-extrabold text-ink-1 ${
              exceedsTank ? "border-error" : "border-hairline-strong"
            }`}
            style={LITERS_INPUT_STYLE}
            placeholder="0"
            placeholderTextColor="#8a8f98"
            keyboardType="numeric"
            autoFocus
            value={liters}
            onChangeText={setLiters}
          />
          <Text className={`text-body-sm ${exceedsTank ? "text-error" : "text-ink-3"}`}>
            {exceedsTank ? "Больше, чем в баке" : " "}
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-label font-bold text-ink-3 uppercase">Фамилия И.О.</Text>
          <TextInput
            className="min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
            placeholder="Иванов И.И."
            placeholderTextColor="#8a8f98"
            autoCapitalize="words"
            autoCorrect={false}
            value={recipientName}
            onChangeText={setRecipientName}
          />
        </View>

        <Pressable
          disabled={busy || !canSubmit}
          onPress={() => void submit()}
          className={`mt-auto min-h-tap-primary rounded-lg px-8 items-center justify-center ${
            busy || !canSubmit ? "bg-surface-4" : "bg-primary active:bg-primary-pressed"
          }`}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className={`text-subheading font-semibold ${canSubmit ? "text-on-primary" : "text-ink-3"}`}>
              Записать
            </Text>
          )}
        </Pressable>
      </View>
    );
  }

  // Фаза «выбор ТС».
  return (
    <View className="flex-1 bg-surface-1 p-6 gap-5" style={{ paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }}>
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          className="min-w-tap-min min-h-tap-min rounded-full bg-canvas border border-hairline-strong items-center justify-center active:bg-surface-3"
        >
          <Text className="text-heading text-ink-1">‹</Text>
        </Pressable>
        <Text className="text-title font-bold text-ink-1">Передача топлива</Text>
      </View>

      <TextInput
        className="min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
        placeholder="Поиск по госномеру"
        placeholderTextColor="#8a8f98"
        autoCapitalize="characters"
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
      />

      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-2"
        contentContainerStyle={{ paddingBottom: insets.bottom }}
      >
        {query.trim().length === 0 ? (
          recentVehicles.length === 0 ? (
            <Text className="text-body-sm text-ink-3 px-1">Начните вводить госномер</Text>
          ) : (
            <View className="gap-2">
              <Text className="text-label font-bold text-ink-3 uppercase px-1">Недавние</Text>
              {recentVehicles.map((vehicle) => (
                <Pressable
                  key={vehicle.id}
                  onPress={() => setSelectedVehicle(vehicle)}
                  className="min-h-[64px] rounded-lg bg-canvas border border-hairline-strong px-4 py-3 justify-center active:bg-surface-3"
                >
                  <Text className="text-subheading font-bold text-ink-1">{vehicle.gosNumber}</Text>
                  <Text className="text-caption text-ink-3">
                    {[vehicle.mark, vehicle.vehicleType].filter(Boolean).join(" · ") || "Без описания"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )
        ) : vehicles.data.length === 0 ? (
          <Text className="text-body-sm text-ink-3 px-1">Ничего не найдено</Text>
        ) : (
          vehicleSections.map((section) => (
            <View key={section.key} className="gap-2">
              <Text className="text-label font-bold text-ink-3 uppercase px-1">{section.title}</Text>
              {section.vehicles.map((vehicle) => (
                <Pressable
                  key={vehicle.id}
                  onPress={() => setSelectedVehicle(vehicle)}
                  className="min-h-[64px] rounded-lg bg-canvas border border-hairline-strong px-4 py-3 justify-center active:bg-surface-3"
                >
                  <Text className="text-subheading font-bold text-ink-1">{vehicle.gosNumber}</Text>
                  <Text className="text-caption text-ink-3">
                    {[vehicle.mark, vehicle.vehicleType].filter(Boolean).join(" · ") || "Без описания"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <Pressable
        onPress={() => router.push("/add-vehicle")}
        className="min-h-tap-secondary bg-canvas border border-hairline-strong rounded-lg px-6 items-center justify-center active:bg-surface-3"
      >
        <Text className="text-ink-1 text-body-sm font-semibold">+ добавить ТС</Text>
      </Pressable>
    </View>
  );
}
