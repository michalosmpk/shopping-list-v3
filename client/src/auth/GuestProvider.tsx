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
  clearGuestSession,
  loadGuestSession,
  saveGuestSession,
  type StoredGuestSession,
} from "./storage";

type GuestContextValue = {
  session: StoredGuestSession | null;
  authenticate: (
    shareToken: string,
    password: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => Promise<void>;
};

const GuestContext = createContext<GuestContextValue | null>(null);

export function GuestProvider({
  shareToken,
  children,
}: {
  shareToken: string;
  children: ReactNode;
}) {
  const [session, setSession] = useState<StoredGuestSession | null>(() => {
    const cur = loadGuestSession();
    return cur && cur.shareToken === shareToken ? cur : null;
  });
  const sessionRef = useRef<StoredGuestSession | null>(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // If the URL's share token changes, the previous guest session is no
  // longer valid for it — clear and let the user re-authenticate.
  useEffect(() => {
    const cur = loadGuestSession();
    if (cur && cur.shareToken !== shareToken) {
      clearGuestSession();
      setSession(null);
      void resetLocalDb();
    }
  }, [shareToken]);

  // Plug into the API client. Guests have no refresh flow — the BFF
  // guest token is long-lived; on auth failure we simply force a
  // re-auth via the password gate.
  useEffect(() => {
    setSessionAdapter({
      getToken: () => sessionRef.current?.token ?? null,
      onAuthError: () => {
        clearGuestSession();
        setSession(null);
      },
    });
    return () => setSessionAdapter(null);
  }, []);

  const authenticate = useCallback(
    async (token: string, password: string) => {
      try {
        const res = await api.authShare(token, password);
        const next: StoredGuestSession = {
          token: res.token,
          listId: res.list_id,
          listName: res.listName,
          shareToken: token,
        };
        saveGuestSession(next);
        sessionRef.current = next;
        setSession(next);
        // Same hygiene as user login: nuke local cache so we don't show
        // someone else's data while the first sync runs.
        await resetLocalDb().catch(() => undefined);
        return { ok: true as const };
      } catch (err) {
        if (err instanceof api.HttpError) {
          if (err.status === 401) {
            return { ok: false as const, error: "Wrong password." };
          }
          if (err.status === 404) {
            return {
              ok: false as const,
              error: "This link is no longer valid.",
            };
          }
          return {
            ok: false as const,
            error: err.detail ?? `Server error (${err.status})`,
          };
        }
        return {
          ok: false as const,
          error: (err as Error).message ?? "Couldn't open share.",
        };
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    clearGuestSession();
    sessionRef.current = null;
    setSession(null);
    await resetLocalDb().catch(() => undefined);
  }, []);

  const value = useMemo<GuestContextValue>(
    () => ({ session, authenticate, signOut }),
    [session, authenticate, signOut]
  );

  return (
    <GuestContext.Provider value={value}>{children}</GuestContext.Provider>
  );
}

export function useGuest() {
  const ctx = useContext(GuestContext);
  if (!ctx) throw new Error("useGuest must be used inside GuestProvider");
  return ctx;
}
