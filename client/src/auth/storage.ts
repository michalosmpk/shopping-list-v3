// Persisted auth state for the client.
//
// Two distinct sessions can exist on the same device, keyed in
// localStorage so they don't collide:
//
//   sl3.user.v2   — Supabase-issued tokens for a logged-in user, plus
//                   a transient admin-elevated token after re-auth.
//   sl3.guest.v1  — BFF-signed guest token for a /share/<token> session.
//
// Both are JSON blobs to keep storage to a single key per session and
// make migrations straightforward.

const USER_KEY = "sl3.user.v2";
const GUEST_KEY = "sl3.guest.v1";

export type StoredUser = {
  id: string;
  name: string;
  displayName: string;
  isAdmin: boolean;
};

export type StoredUserSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;        // ms epoch
  user: StoredUser;
  // Filled in only after a successful admin re-auth.
  adminToken?: string;
  adminTokenExpiresAt?: number;
};

export type StoredGuestSession = {
  token: string;
  listId: string;
  listName: string;
  shareToken: string;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / private browsing — silently degrade.
  }
}

export function loadUserSession(): StoredUserSession | null {
  const s = readJson<StoredUserSession>(USER_KEY);
  if (!s) return null;
  // Strip a stale admin token so consumers never see one that's expired.
  if (
    s.adminTokenExpiresAt &&
    Date.now() > s.adminTokenExpiresAt
  ) {
    delete s.adminToken;
    delete s.adminTokenExpiresAt;
    writeJson(USER_KEY, s);
  }
  return s;
}

export function saveUserSession(session: StoredUserSession): void {
  writeJson(USER_KEY, session);
}

export function clearUserSession(): void {
  localStorage.removeItem(USER_KEY);
}

export function patchUserSession(
  patch: Partial<StoredUserSession>
): StoredUserSession | null {
  const cur = loadUserSession();
  if (!cur) return null;
  const next = { ...cur, ...patch };
  saveUserSession(next);
  return next;
}

export function loadGuestSession(): StoredGuestSession | null {
  return readJson<StoredGuestSession>(GUEST_KEY);
}

export function saveGuestSession(session: StoredGuestSession): void {
  writeJson(GUEST_KEY, session);
}

export function clearGuestSession(): void {
  localStorage.removeItem(GUEST_KEY);
}
