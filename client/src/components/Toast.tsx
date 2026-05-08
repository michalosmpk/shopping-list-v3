import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { v4 as uuid } from "uuid";

const DEFAULT_DURATION = 7000;
const EXIT_MS = 220;

export type ToastSpec = {
  text: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  duration?: number;
};

type ActiveToast = ToastSpec & { id: string };

type ToastContextValue = {
  toast: (spec: ToastSpec) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveToast[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevLength = useRef(0);

  const dismiss = useCallback((id: string) => {
    setActive((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((spec: ToastSpec) => {
    const id = uuid();
    setActive((prev) => [...prev, { ...spec, id }]);
    return id;
  }, []);

  // When a new toast is appended, scroll the stack to its bottom so the
  // newest one is always visible. Don't scroll on dismissals — the user
  // may be reading older toasts.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      prevLength.current = active.length;
      return;
    }
    if (active.length > prevLength.current) {
      requestAnimationFrame(() => {
        node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
      });
    }
    prevLength.current = active.length;
  }, [active.length]);

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss }),
    [toast, dismiss]
  );

  const hasActive = active.length > 0;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          ref={containerRef}
          className={`toasts${hasActive ? " toasts--active" : ""}`}
          role="region"
          aria-label="Notifications"
          aria-live="polite"
        >
          {active.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ActiveToast;
  onDismiss: () => void;
}) {
  const duration = toast.duration ?? DEFAULT_DURATION;
  const [phase, setPhase] = useState<"enter" | "shown" | "exit">("enter");
  const acted = useRef(false);

  useEffect(() => {
    const enterRaf = requestAnimationFrame(() => setPhase("shown"));
    const exitTimer = window.setTimeout(
      () => setPhase("exit"),
      Math.max(0, duration - EXIT_MS)
    );
    const removeTimer = window.setTimeout(() => onDismiss(), duration);
    return () => {
      cancelAnimationFrame(enterRaf);
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
    };
  }, [duration, onDismiss]);

  async function handleAction() {
    if (acted.current) return;
    acted.current = true;
    setPhase("exit");
    try {
      await toast.onAction?.();
    } finally {
      window.setTimeout(onDismiss, EXIT_MS);
    }
  }

  return (
    <div
      className={`toast toast--${phase}`}
      style={{
        // Match the auto-dismiss timer so the progress bar empties exactly
        // as the toast disappears.
        ["--toast-duration" as string]: `${duration}ms`,
      }}
    >
      <span className="toast__text">{toast.text}</span>
      {toast.actionLabel && (
        <button
          type="button"
          className="toast__action"
          onClick={handleAction}
        >
          {toast.actionLabel}
        </button>
      )}
      <span className="toast__progress" aria-hidden />
    </div>
  );
}
