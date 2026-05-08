import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";

export function LoginScreen() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await login(name, password);
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
          Sign in with the account your admin gave you.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="username"
            inputMode="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
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
          />
          <button
            type="submit"
            disabled={busy || !name.trim() || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {!navigator.onLine && (
            <p className="login__hint">
              You're offline — sign-in needs the server to reach you.
            </p>
          )}
          {error && <p className="login__error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
