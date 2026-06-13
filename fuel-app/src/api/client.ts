import type { SyncRequest, SyncResponse } from "../sync/types";

/** Ошибка HTTP-слоя. `isAuth` (401) → нужен повторный логин (refresh-токена нет). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isAuth(): boolean {
    return this.status === 401;
  }
}

/** Минимальный интерфейс, от которого зависит движок синка (для подмены в тестах). */
export interface SyncApi {
  sync(request: SyncRequest): Promise<SyncResponse>;
}

/**
 * HTTP-клиент бэкенда выдачи топлива. Base URL — из `EXPO_PUBLIC_API_URL`
 * (дефолт — боевой VPS). JWT водителя берётся лениво через `getToken` и кладётся в Bearer.
 * login/bootstrap/uploadTtn добавляются в 3.3c/3.3d.
 */
export class ApiClient implements SyncApi {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit & { auth?: boolean } = {}
  ): Promise<T> {
    const { auth = true, headers, ...rest } = init;
    const finalHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(headers as Record<string, string> | undefined),
    };
    if (auth) {
      const token = this.getToken();
      if (token) finalHeaders.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, { ...rest, headers: finalHeaders });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        message = body.error ?? body.message ?? message;
      } catch {
        // тело не JSON — оставляем statusText
      }
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as T;
  }

  sync(request: SyncRequest): Promise<SyncResponse> {
    return this.request<SyncResponse>("/sync", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
}

/** Базовый URL бэкенда (не секрет → EXPO_PUBLIC_*). */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://atz.pisarenkovmax.ru";
