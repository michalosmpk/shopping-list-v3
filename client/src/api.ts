import {
  getActiveAdminToken,
  getActiveToken,
  notifyAuthError,
  tryRefreshActiveSession,
} from "./auth/sessionRegistry";
import type { SyncListPayload } from "./types";

const API_BASE = "/api";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string
  ) {
    super(message);
  }
}

type RequestOptions = RequestInit & {
  auth?: boolean;
  admin?: boolean;
  // Used by the retry-after-refresh path so we don't loop forever.
  _retryOnce?: boolean;
};

async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth !== false) {
    const token = getActiveToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.admin) {
    const adminToken = getActiveAdminToken();
    if (adminToken) headers.set("X-Admin-Token", `Bearer ${adminToken}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401 && options._retryOnce !== true && options.auth !== false) {
    // Try a single refresh and replay the request once.
    const refreshed = await tryRefreshActiveSession();
    if (refreshed) {
      return request<T>(path, { ...options, _retryOnce: true });
    }
    notifyAuthError();
  }

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
      // ignore body parse errors
    }
    throw new HttpError(res.status, res.statusText || `HTTP ${res.status}`, detail);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type AuthUser = {
  id: string;
  name: string;
  displayName: string;
  isAdmin: boolean;
};

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
};

export type SyncResponse = {
  serverTime: number;
  serverVersion: number;
  lists: SyncListPayload[];
};

export type ShareInfo = {
  enabled: boolean;
  token: string | null;
  hasPassword: boolean;
};

export type GuestAuthResponse = {
  token: string;
  list_id: string;
  listName: string;
};

// ---------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------

export const api = {
  HttpError,

  // --- auth -----------------------------------------------------------
  async login(name: string, password: string) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ name, password }),
      auth: false,
    });
  },
  async refresh(refreshToken: string) {
    return request<LoginResponse>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
      auth: false,
    });
  },
  async me() {
    return request<{ kind: "user"; user: AuthUser | null }>("/auth/me");
  },
  async reauthAdmin(password: string) {
    return request<{ admin_token: string; expires_in: number }>(
      "/auth/reauth-admin",
      {
        method: "POST",
        body: JSON.stringify({ password }),
      }
    );
  },

  // --- sync -----------------------------------------------------------
  async heartbeat() {
    return request<{ serverTime: number; serverVersion: number }>(
      "/sync/heartbeat"
    );
  },
  async pull(_since: number) {
    // Server ignores `since` in the current implementation but we keep
    // the call signature to leave room for incremental pulls later.
    return request<SyncResponse>(`/sync`);
  },
  async push(lists: SyncListPayload[]) {
    return request<SyncResponse>("/sync", {
      method: "POST",
      body: JSON.stringify({ lists }),
    });
  },

  // --- admin ----------------------------------------------------------
  async listUsers() {
    return request<{
      users: Array<AuthUser & { createdAt: string }>;
    }>("/admin/users", { admin: true });
  },
  async createUser(input: {
    name: string;
    displayName?: string;
    password: string;
    isAdmin?: boolean;
  }) {
    return request<{ user: AuthUser & { createdAt: string } }>(
      "/admin/users",
      {
        method: "POST",
        body: JSON.stringify(input),
        admin: true,
      }
    );
  },
  async deleteUser(id: string) {
    return request<{ ok: true }>(`/admin/users/${id}`, {
      method: "DELETE",
      admin: true,
    });
  },
  async setUserAdmin(id: string, isAdmin: boolean) {
    return request<{ user: AuthUser & { createdAt: string } }>(
      `/admin/users/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ isAdmin }),
        admin: true,
      }
    );
  },

  // --- share ----------------------------------------------------------
  async getShare(listId: string) {
    return request<ShareInfo>(`/share/${listId}`);
  },
  async updateShare(
    listId: string,
    input: { enabled?: boolean; password?: string | null; regenerate?: boolean }
  ) {
    return request<ShareInfo>(`/share/${listId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  async getShareInfo(token: string) {
    return request<{ ok: true; listName: string; requiresPassword: boolean }>(
      `/share/info/${token}`,
      { auth: false }
    );
  },
  async authShare(token: string, password: string) {
    return request<GuestAuthResponse>(`/share/auth/${token}`, {
      method: "POST",
      body: JSON.stringify({ password }),
      auth: false,
    });
  },
};
