import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { navigate } from "../router";

// "Admin" pill that appears on the lists screen for admins. Tapping it
// requires a fresh password before unlocking /admin — we never let the
// user into the user-management screen on a stale session.
export function AdminButton() {
  const { isAdmin, hasAdminElevation, refreshAdminToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await refreshAdminToken(password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPassword("");
    setOpen(false);
    navigate("/admin");
  }

  function handleOpenClick() {
    if (hasAdminElevation) {
      navigate("/admin");
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        className="adminbtn"
        onClick={handleOpenClick}
        aria-label="Admin"
      >
        Admin
      </button>
      {open && (
        <div
          className="modal__backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm admin password"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="modal">
            <h2>Admin re-auth</h2>
            <p className="modal__body">
              Confirm your password to manage users.
            </p>
            <form onSubmit={handleSubmit}>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                autoFocus
              />
              {error && <p className="login__error">{error}</p>}
              <div className="modal__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={busy || !password}
                >
                  {busy ? "Checking…" : "Continue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
