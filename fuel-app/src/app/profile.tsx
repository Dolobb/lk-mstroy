import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useShifts } from "@/hooks/queries";
import { useSessionStore } from "@/stores/session";

type ShiftRow = {
  id: string;
  atzId: string;
  atzGosNumber: string | null;
  startedAtClient: string;
  endedAtClient: string | null;
  status: string;
  openingRemainingLiters: number | null;
  closingRemainingLiters: number | null;
  dispenseCount: number | null;
  dispenseLiters: number | null;
  receiptLiters: number | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

function formatLiters(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function ShiftCard({ shift }: { shift: ShiftRow }) {
  const isOpen = shift.status === "open";
  const dispenseText = `Выдано: ${formatLiters(shift.dispenseLiters ?? 0)} Л${
    shift.dispenseCount !== null ? ` · ${shift.dispenseCount} опер.` : ""
  }`;
  const closingRemaining =
    shift.closingRemainingLiters === null ? "—" : formatLiters(shift.closingRemainingLiters);

  return (
    <View className="bg-canvas border border-hairline-strong rounded-xl p-5 gap-4">
      <View className="flex-row items-start justify-between gap-4">
        <View className="gap-1 flex-1">
          <Text className="text-subheading font-bold text-ink-1">{formatDate(shift.startedAtClient)}</Text>
          <Text className="text-caption text-ink-3">АТЗ {shift.atzGosNumber ?? "—"}</Text>
        </View>
        <View className="min-h-tap-min rounded-full px-4 bg-surface-1 items-center justify-center">
          <Text className={`text-caption font-semibold ${isOpen ? "text-success" : "text-ink-3"}`}>
            {isOpen ? "Открыта" : "Закрыта"}
          </Text>
        </View>
      </View>

      <View className="gap-2">
        <Text className="text-body-sm text-ink-2">{dispenseText}</Text>
        <Text className="text-body-sm text-ink-2">Принято: {formatLiters(shift.receiptLiters ?? 0)} Л</Text>
        <Text className="text-body-sm text-ink-2">Остаток на закрытие: {closingRemaining} Л</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const driver = useSessionStore((s) => s.driver);
  const shifts = useShifts();

  return (
    <View className="flex-1 bg-surface-1 p-6 gap-6">
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          className="min-h-tap-min min-w-tap-min rounded-full bg-canvas border border-hairline-strong px-4 items-center justify-center active:bg-surface-3"
        >
          <Text className="text-body-sm font-semibold text-ink-1">‹ назад</Text>
        </Pressable>
        <Text className="text-title font-bold text-ink-1">Профиль</Text>
      </View>

      <View className="bg-canvas border border-hairline-strong rounded-xl p-5 gap-1">
        <Text className="text-title font-bold text-ink-1">{driver?.fullName ?? "—"}</Text>
        <Text className="text-caption text-ink-3">{driver?.login ?? "—"}</Text>
      </View>

      <View className="flex-1 gap-3">
        <Text className="text-label font-bold text-ink-3 uppercase">История смен</Text>
        {shifts.data.length === 0 ? (
          <View className="min-h-[68px] rounded-lg bg-canvas border border-hairline px-4 justify-center">
            <Text className="text-body-sm text-ink-3">Смен пока нет</Text>
          </View>
        ) : (
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="gap-3 pb-6">
              {shifts.data.map((shift) => (
                <ShiftCard key={shift.id} shift={shift} />
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );
}
