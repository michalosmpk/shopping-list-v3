import { useSync } from "../sync/SyncProvider";

function formatTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

// Compact pill that fits inside a screen header alongside the back
// button + title. Tap to trigger a sync. The dot color is the primary
// indicator; the label stays short so it doesn't squeeze the title.
export function SyncChip() {
  const { status, lastSyncAt, lastCheckAt, lastError, pending, online, syncNow } =
    useSync();

  const tone = (() => {
    if (!online) return "warn";
    if (status === "syncing") return "info";
    if (status === "error" || status === "auth") return "error";
    if (pending > 0) return "warn";
    return "ok";
  })();

  const label = (() => {
    if (!online) return "Offline";
    if (status === "syncing") return "Sync…";
    if (status === "error") return "Failed";
    if (status === "auth") return "Auth";
    if (pending > 0) return `${pending}`;
    return "Synced";
  })();

  const title = (() => {
    const parts: string[] = [];
    if (status === "error" && lastError) parts.push(lastError);
    if (status === "auth") parts.push("Authentication required");
    if (!online) parts.push("Offline — changes saved locally");
    if (pending > 0) parts.push(`${pending} pending`);
    parts.push(`Synced ${formatTime(lastSyncAt)}`);
    if (lastCheckAt && (!lastSyncAt || lastCheckAt > lastSyncAt + 1500)) {
      parts.push(`Checked ${formatTime(lastCheckAt)}`);
    }
    parts.push("Tap to sync now");
    return parts.join(" · ");
  })();

  return (
    <button
      type="button"
      className={`syncchip syncchip--${tone}`}
      onClick={() => void syncNow()}
      disabled={status === "syncing"}
      aria-label={`Sync status: ${label}. ${title}`}
      title={title}
    >
      <span className={`syncchip__dot syncchip__dot--${tone}`} aria-hidden />
      <span className="syncchip__label">{label}</span>
      <SyncIcon spinning={status === "syncing"} />
    </button>
  );
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`syncchip__icon${spinning ? " spin" : ""}`}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-3.13-6.84" />
      <polyline points="21 4 21 10 15 10" />
    </svg>
  );
}
