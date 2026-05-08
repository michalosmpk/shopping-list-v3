import { useEffect, useState, type FormEvent } from "react";
import { api, type ListMember, type ShareInfo } from "../api";
import { shareUrl } from "../router";
import { TrashIcon } from "./Icons";
import { useToast } from "./Toast";

// Owner-side share configuration. Lives inside ListScreen behind a
// "Share" button.
//
// Two independent ways to share:
//   1. A public link (/share/<token>) gated by a guest password.
//   2. By inviting another registered user by name — they see the list
//      in their own overview and can edit but not delete or re-share.

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
  const [members, setMembers] = useState<ListMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const [cur, mems] = await Promise.all([
        api.getShare(listId),
        api.listMembers(listId),
      ]);
      setInfo(cur);
      setMembers(mems.members);
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

  async function addMember(e: FormEvent) {
    e.preventDefault();
    const trimmed = memberName.trim();
    if (!trimmed) return;
    setMemberError(null);
    setBusy(true);
    try {
      const res = await api.addMember(listId, trimmed);
      setMembers((prev) => [...prev, res.member]);
      setMemberName("");
      toast({ text: `Shared with ${res.member.displayName}`, duration: 3000 });
    } catch (err) {
      if (err instanceof api.HttpError) {
        if (err.status === 404) setMemberError("No user with that name.");
        else if (err.detail === "cannot_add_owner") {
          setMemberError("That's already your account.");
        } else {
          setMemberError(err.detail ?? `Error (${err.status})`);
        }
      } else {
        setMemberError((err as Error).message ?? "Couldn't add user.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: ListMember) {
    if (!confirm(`Remove ${member.displayName} from this list?`)) return;
    setBusy(true);
    try {
      await api.removeMember(listId, member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast({ text: `Removed ${member.displayName}.`, duration: 3000 });
    } catch (err) {
      const msg =
        err instanceof api.HttpError
          ? err.detail ?? `Error (${err.status})`
          : (err as Error).message ?? "Couldn't remove user.";
      toast({ text: msg, duration: 4000 });
    } finally {
      setBusy(false);
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

        {error && <p className="login__error" role="alert">{error}</p>}

        {/* ---- Section 1: share with a known user --------------------- */}
        <section className="share__section">
          <h3 className="share__section-title">People with access</h3>
          <ul className="share__members">
            {members.map((m) => (
              <li key={m.id} className="share__member">
                <div className="share__member-id">
                  <span className="share__member-name">{m.displayName}</span>
                  <span className="share__member-handle">{m.name}</span>
                </div>
                <button
                  type="button"
                  className="row__icon"
                  onClick={() => removeMember(m)}
                  disabled={busy}
                  aria-label={`Remove ${m.displayName}`}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
            {members.length === 0 && (
              <li className="share__empty">No one else can see this yet.</li>
            )}
          </ul>
          <form className="share__row" onSubmit={addMember}>
            <input
              type="text"
              inputMode="text"
              placeholder="user name"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              disabled={busy}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="btn"
              disabled={busy || !memberName.trim()}
            >
              Add
            </button>
          </form>
          {memberError && (
            <p className="login__error" role="alert">{memberError}</p>
          )}
        </section>

        {/* ---- Section 2: public guest link --------------------------- */}
        <section className="share__section">
          <h3 className="share__section-title">Public link</h3>
          <p className="modal__body">
            Anyone with the link and password can edit this list — no account
            required.
          </p>

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
              />
              <div className="modal__actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !password}
                  onClick={() => void enable()}
                >
                  Enable link
                </button>
              </div>
            </form>
          )}
        </section>

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
