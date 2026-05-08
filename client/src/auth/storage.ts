const TOKEN_KEY = "sl3.token";
const EXPIRY_KEY = "sl3.token.expiresAt";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const TOKEN_LIFETIME_DAYS = 365;

export type StoredAuth = {
  token: string;
  expiresAt: number;
};

export function loadAuth(): StoredAuth | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiresAt = Number(localStorage.getItem(EXPIRY_KEY) ?? 0);
    if (!token || !expiresAt) return null;
    if (Date.now() > expiresAt) {
      clearAuth();
      return null;
    }
    return { token, expiresAt };
  } catch {
    return null;
  }
}

export function saveAuth(token: string, lifetimeDays = TOKEN_LIFETIME_DAYS) {
  const expiresAt = Date.now() + lifetimeDays * ONE_DAY_MS;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXPIRY_KEY, String(expiresAt));
  return { token, expiresAt };
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}
