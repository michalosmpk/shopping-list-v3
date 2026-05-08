import { useEffect, useState, type FormEvent } from "react";
import { api, type ShareInfo } from "../api";
import { shareUrl } from "../router";
import { useToast } from "./Toast";

// Owner-side share configuration. Lives inside ListScreen behind a
// "Share" button. Lets the owner enable sharing, rotate the link's
// token, set or clear a guest password, and copy the link.

export function ShareConfigModal({
  listId,
  listName,
  onClose,
}: {
  listId: string;
  listName: string;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const cur = await api.getShare(listId);
      setInfo(cur);
    } catch (err) {
      setError(
        err instanceof api.HttpError
          ? err.detail ?? `Error (${err.status})`
          : (err as Error).message ?? "Failed to load share state."
      );
    } finally {
      setBusy(false);
    }
  }

  async function update(input: Parameters<typeof api.updateShare>[1]) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.updateShare(listId, input);
      setInfo(next);
      return next;
    } catch (err) {
      setError(
        err instanceof api.HttpError
          ? err.detail ?? `Error (${err.status})`
          : (err as Error).message ?? "Update failed."
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    if (!password.trim()) {
      setError("Set a guest password first.");
      return;
    }
    await update({ enabled: true, password });
    setPassword("");
  }

  async function disable() {
    await update({ enabled: false });
  }

  async function rotate() {
    await update({ regenerate: true, enabled: true });
    toast({ text: "Generated a new share link.", duration: 3500 });
  }

  async function setNewPassword(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    const next = await update({ password });
    if (next) {
      setPassword("");
      toast({ text: "Updated guest password.", duration: 3000 });
    }
  }

  async function copyLink() {
    if (!info?.token) return;
    const url = shareUrl(info.token);
    try {
      await navigator.clipboard.writeText(url);
      toast({ text: "Link copied!", duration: 2500 });
    } catch {
      toast({ text: url, duration: 6000 });
    }
  }

  return (
    <div
      className="modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Share list"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--share">
        <h2>Share "{listName}"</h2>
        <p className="modal__body">
          Anyone with the link and password can edit this list.
        </p>

        {error && (
          <p className="login__error" role="alert">{error}</p>
        )}

        {info?.enabled && info.token ? (
          <>
            <div className="share__urlrow">
              <input
                readOnly
                value={shareUrl(info.token)}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="btn"
                onClick={copyLink}
                disabled={busy}
              >
                Copy
              </button>
            </div>
            <div className="share__row">
              <span>Password</span>
              <span className="share__hint">
                {info.hasPassword ? "set" : "not set"}
              </span>
            </div>
            <form onSubmit={setNewPassword} className="share__row">
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Change password…"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                className="btn"
                disabled={busy || !password}
              >
                Update
              </button>
            </form>
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={rotate}
                disabled={busy}
              >
                New link
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={disable}
                disabled={busy}
              >
                Disable
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void enable(); }}>
            <label htmlFor="guest-pw" className="share__label">
              Guest password
            </label>
            <input
              id="guest-pw"
              type="password"
              autoComplete="new-password"
              placeholder="Type a guest password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn"
                disabled={busy || !password}
              >
                Enable sharing
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
