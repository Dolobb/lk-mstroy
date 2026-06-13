import type { BootstrapData, LoginResponse, SyncRequest, SyncResponse } from "../sync/types";

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

/** Полный набор эндпоинтов, используемых приложением. */
export interface FuelApi extends SyncApi {
  login(login: string, pin: string): Promise<LoginResponse>;
  bootstrap(since?: string | null): Promise<BootstrapData>;
  uploadTtn(receiptId: string, fileUri: string): Promise<void>;
}

/**
 * HTTP-клиент бэкенда выдачи топлива. Base URL — из `EXPO_PUBLIC_API_URL` (дефолт — боевой VPS).
 * JWT водителя берётся лениво через `getToken` и кладётся в Bearer.
 */
export class ApiClient implements FuelApi {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null
  ) {}

  private async request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
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
      throw new ApiError(res.status, await readError(res));
    }
    return (await res.json()) as T;
  }

  login(login: string, pin: string): Promise<LoginResponse> {
    return this.request<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ login, pin }),
    });
  }

  bootstrap(since?: string | null): Promise<BootstrapData> {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request<BootstrapData>(`/bootstrap${query}`, { method: "GET" });
  }

  sync(request: SyncRequest): Promise<SyncResponse> {
    return this.request<SyncResponse>("/sync", { method: "POST", body: JSON.stringify(request) });
  }

  /**
   * Загрузка фото ТТН: multipart `photo` (файл) + `receiptId` (текст). Foreground (fetch+FormData),
   * boundary RN выставляет сам — Content-Type руками НЕ ставим. Ретраи — на стороне PhotoQueueStore.
   */
  async uploadTtn(receiptId: string, fileUri: string): Promise<void> {
    const form = new FormData();
    form.append("receiptId", receiptId);
    // RN-форма файла: { uri, name, type } (тип не из DOM — приводим к any)
    form.append("photo", { uri: fileUri, name: `${receiptId}.jpg`, type: "image/jpeg" } as unknown as Blob);

    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}/uploads/ttn`, { method: "POST", headers, body: form });
    if (!res.ok) {
      throw new ApiError(res.status, await readError(res));
    }
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/** Базовый URL бэкенда (не секрет → EXPO_PUBLIC_*). */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://atz.pisarenkovmax.ru";
