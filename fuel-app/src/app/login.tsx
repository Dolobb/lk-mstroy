import { Redirect } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useAuth } from "@/hooks/useAuth";
import { useSessionStore } from "@/stores/session";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
const PIN_LENGTH = 4;

export default function LoginScreen() {
  const status = useSessionStore((s) => s.status);
  const driver = useSessionStore((s) => s.driver);
  const { loginOnline, unlockOffline } = useAuth();

  const [login, setLogin] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "active") return <Redirect href="/main" />;

  const locked = status === "locked";

  async function submit(fullPin: string) {
    if (!locked && login.trim().length === 0) {
      setError("Введите логин");
      setPin("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (locked) {
        const ok = await unlockOffline(fullPin);
        if (!ok) {
          setError("Неверный PIN");
          setPin("");
        }
      } else {
        await loginOnline(login.trim(), fullPin);
      }
    } catch {
      setError(locked ? "Не удалось войти" : "Неверный логин или PIN");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  function onKey(key: string) {
    if (busy || key === "") return;
    if (key === "⌫") {
      setPin((p) => p.slice(0, -1));
      setError(null);
      return;
    }
    const next = (pin + key).slice(0, PIN_LENGTH);
    setPin(next);
    setError(null);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  return (
    <View className="flex-1 bg-surface-1 items-center justify-center p-6 gap-8">
      <View className="items-center gap-2">
        <Text className="text-title font-bold text-ink-1">{locked ? "С возвращением" : "Вход"}</Text>
        {locked ? (
          <Text className="text-body text-ink-2">{driver?.fullName ?? ""}</Text>
        ) : (
          <Text className="text-body-sm text-ink-3">Логин и PIN от диспетчера</Text>
        )}
      </View>

      {!locked && (
        <TextInput
          className="w-full max-w-[320px] min-h-tap-secondary px-4 rounded-md border border-hairline-strong bg-canvas text-body text-ink-1"
          placeholder="Логин (табельный)"
          placeholderTextColor="#8a8f98"
          autoCapitalize="none"
          autoCorrect={false}
          value={login}
          editable={!busy}
          onChangeText={setLogin}
        />
      )}

      <View className="flex-row gap-4">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? "bg-primary" : "bg-surface-4"}`} />
        ))}
      </View>

      <Text className={`text-body-sm ${error ? "text-error" : "text-ink-3"}`}>{error ?? " "}</Text>

      <View className="w-full max-w-[320px] flex-row flex-wrap">
        {KEYS.map((key, idx) => (
          <View key={idx} className="w-1/3 p-2">
            <Pressable
              disabled={key === "" || busy}
              onPress={() => onKey(key)}
              className={`min-h-tap-key items-center justify-center rounded-lg border ${
                key === "" ? "border-transparent" : "border-hairline bg-canvas active:bg-surface-3"
              }`}
            >
              <Text className="text-ink-1" style={{ fontSize: 30, fontWeight: "600" }}>
                {key}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View className="h-6 items-center justify-center">{busy ? <ActivityIndicator color="#5e6ad2" /> : null}</View>
    </View>
  );
}
