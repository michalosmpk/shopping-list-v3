import { useEffect, useRef } from "react";

// Generic in-app confirmation prompt. Used for destructive actions that
// aren't trivially reversible from an undo toast (e.g. deleting a whole
// list along with all its items). Matches the same `.modal__backdrop` +
// `.modal` shell as ShareConfigModal so the styling stays consistent —
// no native window.confirm() (which we deliberately avoid for a11y,
// theming, and predictable behaviour across iOS PWA / desktop).
//
// Keyboard:
//   - Esc           → cancel
//   - Enter         → confirm (focused by default so the user can
//                     muscle-memory through it; the Cancel button is
//                     reachable via Tab)
//   - click outside → cancel
//
// Pass `tone="danger"` to render the confirm button in the red destructive
// style. Default is the regular accent button.

export function ConfirmModal({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Autofocus the primary action so Enter works without a tab dance.
    // setTimeout(0) lets the pop-in animation start; iOS Safari is picky
    // about focus on freshly mounted nodes during transitions.
    const t = window.setTimeout(() => confirmRef.current?.focus(), 0);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      className="modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal modal--confirm">
        <h2 id="confirm-modal-title">{title}</h2>
        {body && <p className="modal__body">{body}</p>}
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={tone === "danger" ? "btn btn--danger" : "btn"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
