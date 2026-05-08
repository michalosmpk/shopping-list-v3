import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";

export function LoginScreen() {
  const { login, loginOffline } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = navigator.onLine
      ? await login(password)
      : loginOffline(password);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setPassword("");
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__icon" aria-hidden>
          <svg viewBox="0 0 64 64" width="48" height="48">
            <rect width="64" height="64" rx="14" fill="#0f766e" />
            <g stroke="#fff" strokeWidth="4" strokeLinecap="round">
              <path d="M18 22h28M18 32h28M18 42h20" />
            </g>
            <g fill="#fff">
              <circle cx="14" cy="22" r="2.5" />
              <circle cx="14" cy="32" r="2.5" />
              <circle cx="14" cy="42" r="2.5" />
            </g>
          </svg>
        </div>
        <h1>Shopping List</h1>
        <p className="login__subtitle">
          Enter the shared password to continue.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            inputMode="text"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <button type="submit" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {!navigator.onLine && (
            <p className="login__hint">
              You're offline — only a previously used password will work.
            </p>
          )}
          {error && <p className="login__error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
