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
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/local";
import {
  checkHeartbeat,
  pendingChangesCount,
  runSync,
  type SyncResult,
} from "./engine";

type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error" | "auth";

type SyncContextValue = {
  status: SyncStatus;
  lastSyncAt: number | null;
  lastCheckAt: number | null;
  lastError: string | null;
  pending: number;
  online: boolean;
  syncNow: () => Promise<SyncResult>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

// Heartbeat fires often and is cheap (single GET, no DB writes).
// Full sync interval is the fallback when heartbeats aren't running
// (e.g. tab hidden) or when there's stuck pending work.
const HEARTBEAT_INTERVAL_MS = 10_000;
const RETRY_INTERVAL_MS = 30_000;

export function SyncProvider({
  children,
  enabled,
  onAuthError,
}: {
  children: ReactNode;
  enabled: boolean;
  onAuthError?: () => void;
}) {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const inFlight = useRef(false);
  const heartbeatTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);

  const pending =
    useLiveQuery(async () => pendingChangesCount(), [], 0) ?? 0;

  const syncNow = useCallback(async (): Promise<SyncResult> => {
    if (!enabled) {
      return { ok: false, reason: "auth" };
    }
    if (inFlight.current) {
      return { ok: false, reason: "error", message: "already syncing" };
    }
    inFlight.current = true;
    setStatus("syncing");
    const res = await runSync();
    inFlight.current = false;

    if (res.ok) {
      setStatus("synced");
      setLastSyncAt(Date.now());
      setLastError(null);
    } else if (res.reason === "offline") {
      setStatus("offline");
    } else if (res.reason === "auth") {
      setStatus("auth");
      setLastError(res.message ?? "Unauthorized");
      onAuthError?.();
    } else {
      setStatus("error");
      setLastError(res.message ?? "Sync failed");
    }
    return res;
  }, [enabled, onAuthError]);

  // Online/offline listeners.
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const handleOffline = () => {
      setOnline(false);
      setStatus("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncNow]);

  // Auto-sync when items change (debounced via tiny timeout) + on mount.
  useEffect(() => {
    if (!enabled) return;
    void syncNow();
  }, [enabled, syncNow]);

  // Lightweight heartbeat: every 10s while visible & online, ask the
  // server for its current version. Trigger a full sync only when it
  // differs from our last-seen value (i.e. someone else changed data),
  // or whenever we have pending local changes to push.
  useEffect(() => {
    if (!enabled) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (!navigator.onLine) return;
      if (inFlight.current) return;

      if (pending > 0) {
        void syncNow();
        return;
      }

      const hb = await checkHeartbeat();
      setLastCheckAt(Date.now());
      if (!hb.ok) {
        if (hb.reason === "auth") {
          setStatus("auth");
          onAuthError?.();
        } else if (hb.reason === "offline") {
          setStatus("offline");
        } else {
          setStatus("error");
          setLastError(hb.message ?? "Heartbeat failed");
        }
        return;
      }
      if (hb.changed) void syncNow();
      else if (status !== "synced") setStatus("synced");
    };
    heartbeatTimer.current = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (heartbeatTimer.current) window.clearInterval(heartbeatTimer.current);
    };
  }, [enabled, pending, status, syncNow, onAuthError]);

  // Slower fallback retry: covers the cases where the heartbeat loop
  // can't run (tab hidden) or has been failing repeatedly.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (status === "syncing") return;
      if (status === "synced" && pending === 0 && online) return;
      void syncNow();
    };
    retryTimer.current = window.setInterval(tick, RETRY_INTERVAL_MS);
    return () => {
      if (retryTimer.current) window.clearInterval(retryTimer.current);
    };
  }, [enabled, online, pending, status, syncNow]);

  // Auto-push when pending count changes (debounced).
  const lastPending = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    if (pending === lastPending.current) return;
    lastPending.current = pending;
    if (pending > 0 && online) {
      const handle = window.setTimeout(() => {
        void syncNow();
      }, 600);
      return () => window.clearTimeout(handle);
    }
  }, [enabled, online, pending, syncNow]);

  // When tab becomes visible, sync.
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled, syncNow]);

  // Reset Dexie listeners when not enabled (e.g. logged out).
  useEffect(() => {
    if (enabled) return;
    setStatus("idle");
    setLastSyncAt(null);
    setLastCheckAt(null);
    setLastError(null);
    void db.lists.toArray().then(() => undefined); // ensure connection open
  }, [enabled]);

  const value = useMemo<SyncContextValue>(
    () => ({
      status,
      lastSyncAt,
      lastCheckAt,
      lastError,
      pending,
      online,
      syncNow,
    }),
    [status, lastSyncAt, lastCheckAt, lastError, pending, online, syncNow]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside SyncProvider");
  return ctx;
}
