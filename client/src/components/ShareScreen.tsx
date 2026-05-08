import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { GuestProvider, useGuest } from "../auth/GuestProvider";
import { SyncProvider } from "../sync/SyncProvider";
import { ToastProvider } from "./Toast";
import { ListScreen } from "./ListScreen";

// Top-level entry for /share/<token>. Wraps the list view in its own
// auth/sync providers so the rest of the app (which assumes a logged-in
// user) is unaffected.
export function ShareScreen({ shareToken }: { shareToken: string }) {
  return (
    <GuestProvider shareToken={shareToken}>
      <ShareGate shareToken={shareToken} />
    </GuestProvider>
  );
}

function ShareGate({ shareToken }: { shareToken: string }) {
  const { session } = useGuest();
  if (!session) {
    return <SharePasswordPrompt shareToken={shareToken} />;
  }
  return (
    <SyncProvider enabled>
      <ToastProvider>
        <div className="app">
          <ListScreen
            listId={session.listId}
            backHref="/"
            mode="guest"
          />
        </div>
      </ToastProvider>
    </SyncProvider>
  );
}

function SharePasswordPrompt({ shareToken }: { shareToken: string }) {
  const { authenticate } = useGuest();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<
    { listName: string; requiresPassword: boolean } | null | "missing"
  >(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.getShareInfo(shareToken);
        if (cancelled) return;
        setInfo({
          listName: res.listName,
          requiresPassword: res.requiresPassword,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof api.HttpError && err.status === 404) {
          setInfo("missing");
        } else {
          setError(
            err instanceof api.HttpError
              ? err.detail ?? `Server error (${err.status})`
              : (err as Error).message ?? "Couldn't reach the server."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authenticate(shareToken, password);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setPassword("");
  }

  if (info === "missing") {
    return (
      <div className="login">
        <div className="login__card">
          <h1>Link not found</h1>
          <p className="login__subtitle">
            This share link has been disabled or no longer exists.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login__card">
        <h1>{info?.listName ?? "Shared list"}</h1>
        <p className="login__subtitle">
          {info?.requiresPassword === false
            ? "Tap to open."
            : "Enter the guest password to continue."}
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Guest password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoFocus={info?.requiresPassword !== false}
          />
          <button
            type="submit"
            disabled={busy || (info?.requiresPassword !== false && !password)}
          >
            {busy ? "Opening…" : "Open list"}
          </button>
          {error && <p className="login__error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
