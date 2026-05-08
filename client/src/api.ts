import { loadAuth } from "./auth/storage";
import type { SyncListPayload } from "./types";

const API_BASE = "/api";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (options.auth !== false) {
    const auth = loadAuth();
    if (auth?.token) headers.set("Authorization", `Bearer ${auth.token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        detail = parsed.message || parsed.error || text;
      } catch {
        detail = text;
      }
    } catch {
      // ignore
    }
    throw new HttpError(res.status, res.statusText, detail);
  }
  return (await res.json()) as T;
}

type SyncResponse = {
  serverTime: number;
  serverVersion: number;
  lists: SyncListPayload[];
};

export const api = {
  HttpError,
  async login(password: string) {
    return request<{ token: string; expiresInDays: number }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
      auth: false,
    });
  },
  async heartbeat() {
    return request<{ serverTime: number; serverVersion: number }>(
      "/sync/heartbeat"
    );
  },
  async pull(since: number) {
    return request<SyncResponse>(`/sync?since=${since}`);
  },
  async push(lists: SyncListPayload[]) {
    return request<SyncResponse>("/sync", {
      method: "POST",
      body: JSON.stringify({ lists }),
    });
  },
};
