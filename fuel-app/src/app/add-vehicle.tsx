import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOrganizations } from "@/hooks/queries";
import { addOrganizationLocal, addVehicleLocal } from "@/sync/mutations";

export default function AddVehicleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const organizations = useOrganizations();
  const [gosNumber, setGosNumber] = useState("");
  const [mark, setMark] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [orgBusy, setOrgBusy] = useState(false);
  const orgSubmittingRef = useRef(false);
  const vehicleSubmittingRef = useRef(false);

  const filteredOrganizations = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return organizations.data;
    return organizations.data.filter((org) => org.name.toLowerCase().includes(needle));
  }, [filter, organizations.data]);

  const trimmedGosNumber = gosNumber.trim();
  const busy = vehicleBusy || orgBusy;
  const canSubmit = trimmedGosNumber.length > 0 && selectedOrgId !== null && !busy;

  async function createOrganization() {
    if (orgSubmittingRef.current) return;
    const name = newOrgName.trim();
    if (!name) return;

    orgSubmittingRef.current = true;
    setOrgBusy(true);
    try {
      const id = await addOrganizationLocal(name);
      setSelectedOrgId(id);
      setNewOrgName("");
      setFilter("");
    } catch (error) {
      Alert.alert("Не удалось создать организацию", error instanceof Error ? error.message : "Попробуйте ещё раз");
    } finally {
      orgSubmittingRef.current = false;
      setOrgBusy(false);
    }
  }

  async function submit() {
    if (vehicleSubmittingRef.current) return;
    if (!canSubmit || !selectedOrgId) return;

    vehicleSubmittingRef.current = true;
    setVehicleBusy(true);
    try {
      await addVehicleLocal({
        gosNumber: trimmedGosNumber,
        organizationId: selectedOrgId,
        mark: mark.trim() || undefined,
        vehicleType: vehicleType.trim() || undefined,
      });
      router.back();
    } catch (error) {
      Alert.alert("Не удалось добавить ТС", error instanceof Error ? error.message : "Попробуйте ещё раз");
    } finally {
      vehicleSubmittingRef.current = false;
      setVehicleBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-surface-1 p-6 gap-5" style={{ paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }}>
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          className="min-w-tap-min min-h-tap-min rounded-full bg-canvas border border-hairline-strong items-center justify-center active:bg-surface-3"
        >
          <Text className="text-heading text-ink-1">‹</Text>
        </Pressable>
        <Text className="text-title font-bold text-ink-1">Добавление ТС</Text>
      </View>

      <View className="gap-3">
        <View className="gap-2">
          <Text className="text-label font-bold text-ink-3 uppercase">Госномер</Text>
          <TextInput
            className="min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
            placeholder="А123ВС"
            placeholderTextColor="#8a8f98"
            autoCapitalize="characters"
            autoCorrect={false}
            value={gosNumber}
            onChangeText={setGosNumber}
          />
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text className="text-label font-bold text-ink-3 uppercase">Марка</Text>
            <TextInput
              className="min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
              placeholder="Опционально"
              placeholderTextColor="#8a8f98"
              value={mark}
              onChangeText={setMark}
            />
          </View>
          <View className="flex-1 gap-2">
            <Text className="text-label font-bold text-ink-3 uppercase">Тип ТС</Text>
            <TextInput
              className="min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
              placeholder="Опционально"
              placeholderTextColor="#8a8f98"
              value={vehicleType}
              onChangeText={setVehicleType}
            />
          </View>
        </View>
      </View>

      <View className="flex-1 gap-3">
        <Text className="text-label font-bold text-ink-3 uppercase">Организация</Text>
        {organizations.data.length > 8 ? (
          <TextInput
            className="min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
            placeholder="Фильтр по названию"
            placeholderTextColor="#8a8f98"
            value={filter}
            onChangeText={setFilter}
          />
        ) : null}

        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-2"
          contentContainerStyle={{ paddingBottom: insets.bottom }}
        >
          {filteredOrganizations.length === 0 ? (
            <Text className="text-body-sm text-ink-3 px-1">Организации не найдены</Text>
          ) : (
            filteredOrganizations.map((org) => {
              const selected = org.id === selectedOrgId;
              return (
                <Pressable
                  key={org.id}
                  onPress={() => setSelectedOrgId(org.id)}
                  className={`min-h-[64px] rounded-lg border px-4 py-3 justify-center active:bg-surface-3 ${
                    selected ? "bg-primary-soft border-primary" : "bg-canvas border-hairline-strong"
                  }`}
                >
                  <Text className="text-subheading font-bold text-ink-1">{org.name}</Text>
                  <Text className="text-caption text-ink-3">
                    {[org.kind, org.source].filter(Boolean).join(" · ")}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>

      <View className="bg-canvas rounded-xl border border-hairline-strong p-4 gap-3">
        <Text className="text-label font-bold text-ink-3 uppercase">+ новая организация</Text>
        <View className="flex-row gap-3">
          <TextInput
            className="flex-1 min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
            placeholder="Название"
            placeholderTextColor="#8a8f98"
            value={newOrgName}
            onChangeText={setNewOrgName}
          />
          <Pressable
            disabled={orgBusy || newOrgName.trim().length === 0}
            onPress={() => void createOrganization()}
            className={`min-h-tap-secondary px-6 rounded-lg items-center justify-center ${
              orgBusy || newOrgName.trim().length === 0 ? "bg-surface-3" : "bg-primary active:bg-primary-pressed"
            }`}
          >
            {orgBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className={`text-body-sm font-semibold ${newOrgName.trim().length > 0 ? "text-on-primary" : "text-ink-3"}`}>
                Создать
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      <Pressable
        disabled={!canSubmit}
        onPress={() => void submit()}
        className={`min-h-tap-primary rounded-lg px-8 items-center justify-center ${
          canSubmit ? "bg-primary active:bg-primary-pressed" : "bg-surface-3"
        }`}
      >
        {vehicleBusy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className={`text-subheading font-semibold ${canSubmit ? "text-on-primary" : "text-ink-3"}`}>
            Добавить ТС
          </Text>
        )}
      </Pressable>
    </View>
  );
}
