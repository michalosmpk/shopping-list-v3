import { useSync } from "../sync/SyncProvider";

function formatTime(ts: number | null) {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

export function SyncBar() {
  const {
    status,
    lastSyncAt,
    lastCheckAt,
    lastError,
    pending,
    online,
    syncNow,
  } = useSync();

  const label = (() => {
    if (!online) return "Offline";
    if (status === "syncing") return "Syncing…";
    if (status === "error") return "Sync failed";
    if (status === "auth") return "Auth required";
    if (pending > 0) return `${pending} pending`;
    return "Synced";
  })();

  const tone = (() => {
    if (!online) return "warn";
    if (status === "syncing") return "info";
    if (status === "error" || status === "auth") return "error";
    if (pending > 0) return "warn";
    return "ok";
  })();

  // Sub-line: show last full sync, plus last heartbeat if we've checked
  // since the last sync (so user sees the connection is alive).
  const sub = (() => {
    const synced = `synced ${formatTime(lastSyncAt)}`;
    if (lastCheckAt && (!lastSyncAt || lastCheckAt > lastSyncAt + 1500)) {
      return `${synced} · checked ${formatTime(lastCheckAt)}`;
    }
    return synced;
  })();

  return (
    <div className={`syncbar syncbar--${tone}`}>
      <div className="syncbar__left">
        <span className={`syncbar__dot syncbar__dot--${tone}`} />
        <span className="syncbar__label">{label}</span>
        <span className="syncbar__sub">· {sub}</span>
      </div>
      <button
        type="button"
        className="syncbar__btn"
        onClick={() => void syncNow()}
        disabled={status === "syncing"}
        aria-label="Sync now"
      >
        <SyncIcon spinning={status === "syncing"} />
      </button>
      {lastError && status !== "synced" && status !== "syncing" && (
        <div className="syncbar__error" role="alert">
          {lastError}
        </div>
      )}
    </div>
  );
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "spin" : undefined}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-3.13-6.84" />
      <polyline points="21 4 21 10 15 10" />
    </svg>
  );
}
