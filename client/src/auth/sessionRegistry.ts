// Module-level registry the API client reads from on every request.
//
// Auth and guest providers register their token-getters here on mount;
// the API layer doesn't need to know which kind of session is active,
// it just asks for the current bearer token (and an optional admin
// token / refresh hook).

type Adapter = {
  getToken: () => string | null;
  getAdminToken?: () => string | null;
  refresh?: () => Promise<boolean>;
  onAuthError?: () => void;
};

let adapter: Adapter | null = null;

export function setSessionAdapter(next: Adapter | null): void {
  adapter = next;
}

export function getActiveToken(): string | null {
  return adapter?.getToken() ?? null;
}

export function getActiveAdminToken(): string | null {
  return adapter?.getAdminToken?.() ?? null;
}

export async function tryRefreshActiveSession(): Promise<boolean> {
  if (!adapter?.refresh) return false;
  try {
    return await adapter.refresh();
  } catch {
    return false;
  }
}

export function notifyAuthError(): void {
  adapter?.onAuthError?.();
}
