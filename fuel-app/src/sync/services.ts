import { ApiClient, API_BASE_URL } from "../api/client";
import { db } from "../db/client";
import { OutboxStore } from "./outbox";
import { PhotoQueueStore } from "./photos";
import { loadSession } from "./session";

/**
 * Singleton-сервисы синка для приложения (инстанцируются один раз на запуск).
 * Ядро (OutboxStore/PhotoQueueStore) уже покрыто тестами на инъектируемом db; здесь — боевая
 * проводка к локальной expo-sqlite БД и HTTP-клиенту. JWT держим в модульной переменной,
 * `ApiClient` читает её лениво (после логина выставляем через setAuthToken).
 */
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/**
 * Провайдер JWT для api: сперва in-memory (быстро, выставляется при логине), иначе — фолбэк на
 * secure-store. Фолбэк критичен: module-level `authToken` обнуляется при Fast Refresh и не
 * переживает перезапуск приложения, из-за чего authed-запросы падали с 401 unauthorized.
 */
async function resolveAuthToken(): Promise<string | null> {
  if (authToken) return authToken;
  const session = await loadSession();
  authToken = session?.token ?? null;
  return authToken;
}

export const api = new ApiClient(API_BASE_URL, resolveAuthToken);
export const outboxStore = new OutboxStore(db);
export const photoQueue = new PhotoQueueStore(db);

export { db };
