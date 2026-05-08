import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api";
import { resetLocalDb } from "../db/local";
import { setSessionAdapter } from "./sessionRegistry";
import {
  clearUserSession,
  loadUserSession,
  patchUserSession,
  saveUserSession,
  type StoredUser,
  type StoredUserSession,
} from "./storage";

type AuthState =
  | { kind: "loggedOut" }
  | { kind: "loggedIn"; session: StoredUserSession };

type AuthContextValue = {
  state: AuthState;
  user: StoredUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  hasAdminElevation: boolean;
  login: (
    name: string,
    password: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  refreshAdminToken: (
    password: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  // Forces a re-fetch of /auth/me; used after admin operations that may
  // have changed the current user's flags (e.g. self-edit edge cases).
  reloadProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Refresh proactively when the access token has < this many ms remaining.
const REFRESH_LEEWAY_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const session = loadUserSession();
    return session
      ? { kind: "loggedIn", session }
      : { kind: "loggedOut" };
  });

  // Keep a ref to the current session for the refresh closure that
  // gets registered with the API; we need a stable identity but
  // up-to-date data.
  const sessionRef = useRef<StoredUserSession | null>(
    state.kind === "loggedIn" ? state.session : null
  );
  useEffect(() => {
    sessionRef.current =
      state.kind === "loggedIn" ? state.session : null;
  }, [state]);

  const refreshing = useRef<Promise<boolean> | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (refreshing.current) return refreshing.current;
    const cur = sessionRef.current;
    if (!cur?.refreshToken) return false;
    const p = (async () => {
      try {
        const res = await api.refresh(cur.refreshToken);
        const next: StoredUserSession = {
          accessToken: res.access_token,
          refreshToken: res.refresh_token,
          expiresAt: (res.expires_at ?? 0) * 1000,
          user: res.user,
          adminToken: cur.adminToken,
          adminTokenExpiresAt: cur.adminTokenExpiresAt,
        };
        saveUserSession(next);
        sessionRef.current = next;
        setState({ kind: "loggedIn", session: next });
        return true;
      } catch {
        return false;
      }
    })();
    refreshing.current = p;
    try {
      return await p;
    } finally {
      refreshing.current = null;
    }
  }, []);

  // Wire ourselves into the API client so it can read the current
  // bearer/admin tokens and trigger a refresh on 401s.
  useEffect(() => {
    setSessionAdapter({
      getToken: () => sessionRef.current?.accessToken ?? null,
      getAdminToken: () => {
        const s = sessionRef.current;
        if (!s?.adminToken) return null;
        if (
          s.adminTokenExpiresAt &&
          Date.now() > s.adminTokenExpiresAt
        ) {
          // Stale — drop it.
          patchUserSession({ adminToken: undefined, adminTokenExpiresAt: undefined });
          sessionRef.current = loadUserSession();
          return null;
        }
        return s.adminToken;
      },
      refresh,
      onAuthError: () => {
        clearUserSession();
        sessionRef.current = null;
        setState({ kind: "loggedOut" });
      },
    });
    return () => setSessionAdapter(null);
  }, [refresh]);

  // Proactively refresh when the access token is about to expire.
  useEffect(() => {
    if (state.kind !== "loggedIn") return;
    const ms = state.session.expiresAt - Date.now() - REFRESH_LEEWAY_MS;
    if (ms <= 0) {
      void refresh();
      return;
    }
    const handle = window.setTimeout(() => void refresh(), ms);
    return () => window.clearTimeout(handle);
  }, [state, refresh]);

  const login = useCallback(
    async (name: string, password: string) => {
      try {
        const res = await api.login(name.trim(), password);
        const session: StoredUserSession = {
          accessToken: res.access_token,
          refreshToken: res.refresh_token,
          expiresAt: (res.expires_at ?? 0) * 1000,
          user: res.user,
        };
        saveUserSession(session);
        sessionRef.current = session;
        setState({ kind: "loggedIn", session });
        // Switching identities — start clean. The sync engine pulls
        // everything fresh on the next tick.
        await resetLocalDb().catch(() => undefined);
        return { ok: true as const };
      } catch (err) {
        if (err instanceof api.HttpError) {
          if (err.status === 401) {
            return { ok: false as const, error: "Wrong name or password." };
          }
          const suffix = err.detail ? `: ${err.detail}` : "";
          return {
            ok: false as const,
            error: `Server error (${err.status})${suffix}`,
          };
        }
        if (
          err instanceof TypeError ||
          (err as { message?: string })?.message?.includes("fetch")
        ) {
          return {
            ok: false as const,
            error: "Can't reach the server.",
          };
        }
        return {
          ok: false as const,
          error: (err as Error).message ?? "Login failed.",
        };
      }
    },
    []
  );

  const logout = useCallback(async () => {
    clearUserSession();
    sessionRef.current = null;
    setState({ kind: "loggedOut" });
    await resetLocalDb().catch(() => undefined);
  }, []);

  const refreshAdminToken = useCallback(
    async (password: string) => {
      try {
        const res = await api.reauthAdmin(password);
        const expiresAt = Date.now() + res.expires_in * 1000;
        const next = patchUserSession({
          adminToken: res.admin_token,
          adminTokenExpiresAt: expiresAt,
        });
        if (next) {
          sessionRef.current = next;
          setState({ kind: "loggedIn", session: next });
        }
        return { ok: true as const };
      } catch (err) {
        if (err instanceof api.HttpError) {
          if (err.status === 401) {
            return { ok: false as const, error: "Wrong password." };
          }
          if (err.status === 403) {
            return {
              ok: false as const,
              error: "You're no longer an admin.",
            };
          }
          return {
            ok: false as const,
            error: err.detail ?? `Server error (${err.status})`,
          };
        }
        return {
          ok: false as const,
          error: (err as Error).message ?? "Re-auth failed.",
        };
      }
    },
    []
  );

  const reloadProfile = useCallback(async () => {
    try {
      const res = await api.me();
      if (res.user) {
        const cur = sessionRef.current;
        if (!cur) return;
        const next = patchUserSession({ user: res.user });
        if (next) {
          sessionRef.current = next;
          setState({ kind: "loggedIn", session: next });
        }
      }
    } catch {
      // ignore — caller doesn't depend on it
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const session = state.kind === "loggedIn" ? state.session : null;
    return {
      state,
      user: session?.user ?? null,
      isAuthenticated: !!session,
      isAdmin: !!session?.user.isAdmin,
      hasAdminElevation:
        !!session?.adminToken &&
        !!session.adminTokenExpiresAt &&
        Date.now() < session.adminTokenExpiresAt,
      login,
      logout,
      refreshAdminToken,
      reloadProfile,
    };
  }, [state, login, logout, refreshAdminToken, reloadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
