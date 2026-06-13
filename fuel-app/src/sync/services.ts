import { ApiClient, API_BASE_URL } from "../api/client";
import { db } from "../db/client";
import { OutboxStore } from "./outbox";
import { PhotoQueueStore } from "./photos";

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

export const api = new ApiClient(API_BASE_URL, () => authToken);
export const outboxStore = new OutboxStore(db);
export const photoQueue = new PhotoQueueStore(db);

export { db };
