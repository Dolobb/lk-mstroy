import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

/**
 * Сессия и идентичность устройства в Android Keystore (expo-secure-store).
 * Храним: deviceId (раз и навсегда), JWT, профиль водителя, bcrypt-хэш PIN (для офлайн-входа).
 * Чистый PIN НИКОГДА не храним.
 */
const KEY = {
  deviceId: "fuel_device_id",
  token: "fuel_jwt",
  driver: "fuel_driver",
  pinHash: "fuel_pin_hash",
} as const;

export interface CachedDriver {
  id: string;
  login: string;
  fullName: string;
}

export interface Session {
  token: string;
  driver: CachedDriver;
  pinHash: string;
}

/** deviceId генерится один раз (expo-crypto) и переживает перелогины. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY.deviceId);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(KEY.deviceId, id);
  return id;
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY.token, session.token);
  await SecureStore.setItemAsync(KEY.driver, JSON.stringify(session.driver));
  await SecureStore.setItemAsync(KEY.pinHash, session.pinHash);
}

export async function loadSession(): Promise<Session | null> {
  const [token, driverRaw, pinHash] = await Promise.all([
    SecureStore.getItemAsync(KEY.token),
    SecureStore.getItemAsync(KEY.driver),
    SecureStore.getItemAsync(KEY.pinHash),
  ]);
  if (!token || !driverRaw || !pinHash) return null;
  return { token, driver: JSON.parse(driverRaw) as CachedDriver, pinHash };
}

/** Выход: чистим сессию, но deviceId оставляем (привязка устройства). */
export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY.token),
    SecureStore.deleteItemAsync(KEY.driver),
    SecureStore.deleteItemAsync(KEY.pinHash),
  ]);
}
