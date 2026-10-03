import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Preset } from "../api";
import { createItem } from "../db/operations";
import { ShareIcon, TrashIcon } from "./Icons";
import { useToast } from "./Toast";

type ListItem = {
  id: string;
  name: string;
  quantity: string;
  checked: boolean;
};

type View = "browse" | "create" | "share";

// Logged-in users only. The parent hides this for guest sessions.
// Presets live on the server (they're account data, not list rows) and
// applying one writes ordinary local items so they sync like anything
// else the user typed.
export function PresetsModal({
  listId,
  listName,
  items,
  onClose,
}: {
  listId: string;
  listName: string;
  items: ListItem[];
  onClose: () => void;
}) {
  const [view, setView] = useState<View>("browse");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState(listName);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sharing, setSharing] = useState<Preset | null>(null);
  const [memberName, setMemberName] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const { toast } = useToast();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.listPresets();
      if (!alive.current) return;
      setPresets(res.presets);
      setSharing((current) => {
        if (!current) return current;
        return res.presets.find((p) => p.id === current.id) ?? current;
      });
    } catch (err) {
      if (!alive.current) return;
      setError(messageFrom(err, "Couldn't load presets."));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function startCreate() {
    setPresetName(listName);
    setSelected(new Set(items.map((item) => item.id)));
    setError(null);
    setView("create");
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function savePreset(e: FormEvent) {
    e.preventDefault();
    const chosen = items.filter((item) => selected.has(item.id) && item.name.trim());
    if (!presetName.trim() || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createPreset({
        name: presetName.trim(),
        items: chosen.map((item) => ({
          name: item.name,
          quantity: item.quantity,
        })),
      });
      setPresets((prev) => [res.preset, ...prev]);
      setView("browse");
      toast({ text: `Saved preset "${res.preset.name}".`, duration: 3000 });
    } catch (err) {
      setError(messageFrom(err, "Couldn't save preset."));
    } finally {
      setBusy(false);
    }
  }

  async function applyPreset(preset: Preset) {
    if (preset.items.length === 0) return;
    setBusy(true);
    try {
      for (const item of preset.items) {
        await createItem(listId, item.name, item.quantity);
      }
      const n = preset.items.length;
      toast({
        text: `Added ${n} item${n === 1 ? "" : "s"} from "${preset.name}".`,
        duration: 3000,
      });
      onClose();
    } catch (err) {
      setError(messageFrom(err, "Couldn't add those items."));
      setBusy(false);
    }
  }

  async function removePreset(preset: Preset) {
    setPresets((prev) => prev.filter((p) => p.id !== preset.id));
    if (sharing?.id === preset.id) {
      setSharing(null);
      setView("browse");
    }
    try {
      await api.deletePreset(preset.id);
    } catch (err) {
      setPresets((prev) => [preset, ...prev]);
      toast({ text: messageFrom(err, "Couldn't delete preset."), duration: 4000 });
      return;
    }
    toast({
      text: `Deleted "${preset.name}"`,
      actionLabel: "Undo",
      duration: 10000,
      onAction: async () => {
        const restored = await api.createPreset({
          name: preset.name,
          items: preset.items,
        });
        for (const member of preset.members) {
          try {
            await api.addPresetMember(restored.preset.id, member.name);
          } catch {
            // A member who no longer exists shouldn't block the undo.
          }
        }
        if (alive.current) await load();
      },
    });
  }

  function openShare(preset: Preset) {
    setSharing(preset);
    setMemberName("");
    setMemberError(null);
    setView("share");
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    if (!sharing) return;
    const trimmed = memberName.trim();
    if (!trimmed) return;
    setMemberError(null);
    setBusy(true);
    try {
      const res = await api.addPresetMember(sharing.id, trimmed);
      const member = res.member;
      setPresets((prev) =>
        prev.map((p) =>
          p.id === sharing.id ? { ...p, members: [...p.members, member] } : p
        )
      );
      setSharing((current) =>
        current && current.id === sharing.id
          ? { ...current, members: [...current.members, member] }
          : current
      );
      setMemberName("");
      toast({ text: `Shared with ${member.displayName}.`, duration: 3000 });
    } catch (err) {
      if (err instanceof api.HttpError) {
        if (err.status === 404) setMemberError("No user with that name.");
        else if (err.detail === "cannot_add_owner") {
          setMemberError("That's already your account.");
        } else if (err.detail === "already_member") {
          setMemberError("They're already on this preset.");
        } else {
          setMemberError(err.detail ?? `Error (${err.status})`);
        }
      } else {
        setMemberError("Couldn't add user.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: string, displayName: string) {
    if (!sharing) return;
    setBusy(true);
    try {
      await api.removePresetMember(sharing.id, memberId);
      const drop = (p: Preset) =>
        p.id === sharing.id
          ? { ...p, members: p.members.filter((m) => m.id !== memberId) }
          : p;
      setPresets((prev) => prev.map(drop));
      setSharing((current) => (current ? drop(current) : current));
      toast({ text: `Removed ${displayName}.`, duration: 3000 });
    } catch (err) {
      toast({ text: messageFrom(err, "Couldn't remove user."), duration: 4000 });
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = items.filter((item) => selected.has(item.id)).length;

  return (
    <div
      className="modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Presets"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--presets">
        {view === "browse" && (
          <>
            <h2>Presets</h2>
            <p className="modal__body">
              Save items from this list, then drop them onto any list later.
              Share a preset with another account so they can use it too.
            </p>
            {error && <p className="login__error" role="alert">{error}</p>}
            <button
              type="button"
              className="btn"
              onClick={startCreate}
              disabled={busy || items.length === 0}
            >
              Create from this list
            </button>
            {items.length === 0 && (
              <p className="presets__hint">Add items to this list first.</p>
            )}
            <ul className="presets__list">
              {presets.map((preset) => (
                <li key={preset.id} className="presets__card">
                  <button
                    type="button"
                    className="presets__apply"
                    onClick={() => applyPreset(preset)}
                    disabled={busy || preset.items.length === 0}
                  >
                    <span className="presets__name">{preset.name}</span>
                    <span className="presets__meta">
                      {`${preset.items.length} item${preset.items.length === 1 ? "" : "s"}`}
                      {!preset.isOwner && ` · from ${preset.ownerDisplayName}`}
                      {preset.isOwner &&
                        preset.members.length > 0 &&
                        ` · shared with ${preset.members.length}`}
                    </span>
                  </button>
                  {preset.isOwner && (
                    <div className="presets__actions">
                      <button
                        type="button"
                        className="row__icon"
                        aria-label={`Share ${preset.name}`}
                        onClick={() => openShare(preset)}
                        disabled={busy}
                      >
                        <ShareIcon />
                      </button>
                      <button
                        type="button"
                        className="row__icon"
                        aria-label={`Delete ${preset.name}`}
                        onClick={() => removePreset(preset)}
                        disabled={busy}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  )}
                </li>
              ))}
              {!busy && presets.length === 0 && (
                <li className="presets__empty">No presets yet.</li>
              )}
            </ul>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {view === "create" && (
          <form onSubmit={savePreset} className="presets__create">
            <h2>New preset</h2>
            <p className="modal__body">
              {`Choose which items from "${listName}" to keep.`}
            </p>
            {error && <p className="login__error" role="alert">{error}</p>}
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              disabled={busy}
              autoFocus
            />
            <div className="presets__toggles">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setSelected(new Set(items.map((item) => item.id)))}
                disabled={busy}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setSelected(new Set())}
                disabled={busy}
              >
                Deselect all
              </button>
            </div>
            <ul className="presets__picker">
              {items.map((item) => {
                const on = selected.has(item.id);
                return (
                  <li key={item.id}>
                    <label className="presets__pick">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleSelected(item.id)}
                        disabled={busy}
                      />
                      <span className="presets__pick-name">
                        {item.name || "Untitled"}
                        {item.checked && (
                          <span className="presets__checked">checked</span>
                        )}
                      </span>
                      {item.quantity && (
                        <span className="presets__qty">{item.quantity}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setError(null);
                  setView("browse");
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn"
                disabled={busy || !presetName.trim() || selectedCount === 0}
              >
                Save {selectedCount > 0 ? `(${selectedCount})` : ""}
              </button>
            </div>
          </form>
        )}

        {view === "share" && sharing && (
          <>
            <h2>{`Share "${sharing.name}"`}</h2>
            <p className="modal__body">
              They can add these items to their own lists. Only you can
              change who has access.
            </p>
            <ul className="share__members">
              {sharing.members.map((member) => (
                <li key={member.id} className="share__member">
                  <div className="share__member-id">
                    <span className="share__member-name">{member.displayName}</span>
                    <span className="share__member-handle">{member.name}</span>
                  </div>
                  <button
                    type="button"
                    className="row__icon"
                    aria-label={`Remove ${member.displayName}`}
                    onClick={() => removeMember(member.id, member.displayName)}
                    disabled={busy}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
              {sharing.members.length === 0 && (
                <li className="share__empty">No one else can use this yet.</li>
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
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setView("browse")}
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof api.HttpError) return err.detail ?? fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
