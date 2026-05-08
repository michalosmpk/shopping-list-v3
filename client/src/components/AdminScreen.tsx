import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type AuthUser } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { navigate } from "../router";
import { ChevronLeft, PlusIcon, TrashIcon } from "./Icons";
import { useToast } from "./Toast";

type AdminUser = AuthUser & { createdAt: string };

export function AdminScreen() {
  const { hasAdminElevation, isAdmin, user } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only admins with a fresh elevation may stay on this screen — anyone
  // else is bounced back to the home screen which (for admins) shows
  // the re-auth modal again.
  useEffect(() => {
    if (!isAdmin || !hasAdminElevation) {
      navigate("/", { replace: true });
    }
  }, [isAdmin, hasAdminElevation]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.listUsers();
      setUsers(res.users);
    } catch (err) {
      if (err instanceof api.HttpError) {
        if (err.status === 401) {
          navigate("/", { replace: true });
          return;
        }
        setError(err.detail ?? `Server error (${err.status})`);
      } else {
        setError((err as Error).message ?? "Failed to load users");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (hasAdminElevation) void refresh();
  }, [hasAdminElevation, refresh]);

  return (
    <div className="screen">
      <header className="header">
        <button
          type="button"
          className="iconbtn"
          onClick={() => navigate("/")}
          aria-label="Back"
        >
          <ChevronLeft />
        </button>
        <h1 className="header__title">Admin</h1>
      </header>

      <CreateUserForm onCreated={() => void refresh()} />

      {error && <p className="login__error" role="alert">{error}</p>}

      <ul className="rows rows--admin">
        {(users ?? []).map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === user?.id}
            onChanged={() => void refresh()}
          />
        ))}
        {users && users.length === 0 && !busy && (
          <li className="empty">
            <p>No users yet.</p>
          </li>
        )}
        {!users && busy && (
          <li className="empty">
            <p>Loading…</p>
          </li>
        )}
      </ul>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({
        name: name.trim(),
        password,
        isAdmin,
      });
      toast({ text: `Created "${name.trim()}"`, duration: 3500 });
      setName("");
      setPassword("");
      setIsAdmin(false);
      onCreated();
    } catch (err) {
      if (err instanceof api.HttpError) {
        if (err.status === 409) setError("That name is already taken.");
        else if (err.status === 400) {
          setError(
            err.detail === "password_too_short"
              ? "Password must be at least 6 characters."
              : "Name must be 2–32 chars: a–z, 0–9, dot, dash, underscore."
          );
        } else {
          setError(err.detail ?? `Server error (${err.status})`);
        }
      } else {
        setError((err as Error).message ?? "Could not create user.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="addbar addbar--admin" onSubmit={handleSubmit}>
      <input
        type="text"
        inputMode="text"
        placeholder="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
        aria-label="Name"
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
        aria-label="Password"
      />
      <label className="addbar__check" title="Admin">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
          disabled={busy}
        />
        <span>admin</span>
      </label>
      <button
        type="submit"
        disabled={busy || !name.trim() || !password}
        aria-label="Add user"
      >
        <PlusIcon />
      </button>
      {error && (
        <p className="login__error addbar__error" role="alert">{error}</p>
      )}
    </form>
  );
}

function UserRow({
  user,
  isSelf,
  onChanged,
}: {
  user: AdminUser;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function toggleAdmin() {
    setBusy(true);
    try {
      await api.setUserAdmin(user.id, !user.isAdmin);
      onChanged();
    } catch (err) {
      const detail =
        err instanceof api.HttpError
          ? err.detail ?? `Error (${err.status})`
          : (err as Error).message ?? "Failed";
      toast({ text: detail, duration: 4000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove user "${user.displayName || user.name}"?`)) return;
    setBusy(true);
    try {
      await api.deleteUser(user.id);
      toast({ text: `Removed "${user.name}"`, duration: 3500 });
      onChanged();
    } catch (err) {
      const detail =
        err instanceof api.HttpError
          ? err.detail ?? `Error (${err.status})`
          : (err as Error).message ?? "Failed";
      toast({ text: detail, duration: 4000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <div className="row row--admin">
        <div className="row__main row__main--readonly">
          <span className="row__title">
            {user.displayName || user.name}
            {isSelf && <span className="badge"> you</span>}
            {user.isAdmin && <span className="badge badge--admin"> admin</span>}
          </span>
          <span className="row__meta">{user.name}</span>
        </div>
        <button
          type="button"
          className={`pillbtn${user.isAdmin ? " pillbtn--on" : ""}`}
          onClick={toggleAdmin}
          disabled={busy || isSelf}
          title={isSelf ? "You can't change your own admin flag." : ""}
        >
          {user.isAdmin ? "Demote" : "Promote"}
        </button>
        <button
          type="button"
          className="row__icon"
          onClick={handleDelete}
          aria-label={`Remove ${user.name}`}
          disabled={busy || isSelf}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}
