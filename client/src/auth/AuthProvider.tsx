import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api";
import { clearAuth, loadAuth, saveAuth, type StoredAuth } from "./storage";

type AuthContextValue = {
  auth: StoredAuth | null;
  isAuthenticated: boolean;
  login: (password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  loginOffline: (password: string) => { ok: true } | { ok: false; error: string };
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadAuth());

  useEffect(() => {
    // Re-check expiration each minute.
    const handle = window.setInterval(() => {
      const fresh = loadAuth();
      if (!fresh && auth) setAuth(null);
    }, 60_000);
    return () => window.clearInterval(handle);
  }, [auth]);

  const login = useCallback(
    async (password: string) => {
      try {
        const res = await api.login(password);
        const stored = saveAuth(res.token, res.expiresInDays);
        setAuth(stored);
        return { ok: true as const };
      } catch (err) {
        if (err instanceof api.HttpError) {
          if (err.status === 401) {
            return { ok: false as const, error: "Wrong password." };
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
            error:
              "Can't reach the server. Try again, or use offline mode if you've logged in before.",
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

  // Offline path: trust a previously stored token. Used when network is
  // down and the user wants to keep working with cached data. The server
  // will re-validate as soon as it's reachable.
  const loginOffline = useCallback((password: string) => {
    const existing = loadAuth();
    if (existing && existing.token === password) {
      setAuth(existing);
      return { ok: true as const };
    }
    return {
      ok: false as const,
      error: "Offline login only works after at least one online login.",
    };
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setAuth(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      isAuthenticated: !!auth,
      login,
      loginOffline,
      logout,
    }),
    [auth, login, loginOffline, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
