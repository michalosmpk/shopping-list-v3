import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { TrashIcon } from "./Icons";

const ACTIVATE_PX = 8;        // start tracking after this much horizontal motion
const COMMIT_PX = 96;         // pull this far to commit a delete
const ANIMATE_MS = 180;

type Props = {
  onDelete: () => void | Promise<void>;
  children: ReactNode;
  className?: string;
  // Selector for inner elements that should NOT initiate a swipe
  // (e.g. the drag handle). Defaults to the dnd-kit handle class.
  ignoreSelector?: string;
};

// Native-feeling iOS-style swipe-left-to-delete. Doesn't interfere with
// vertical scrolling (touch-action: pan-y) and bows out cleanly when the
// pointer originates on a drag handle so dnd-kit can take over.
export function Swipeable({
  onDelete,
  children,
  className,
  ignoreSelector = "[data-no-swipe], .row__handle",
}: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const captured = useRef(false);
  // Once a gesture is judged to be a vertical scroll (or anything that
  // isn't a clean left-swipe) we bail for the REST of that pointer
  // sequence. Without this, a scroll that momentarily leans left could
  // re-trigger capture on a later move and flash the delete background.
  const bailed = useRef(false);
  const pointerId = useRef<number | null>(null);

  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [removing, setRemoving] = useState(false);

  function reset(animate = true) {
    setAnimating(animate);
    setDx(0);
    captured.current = false;
    bailed.current = false;
    pointerId.current = null;
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (removing) return;
    const target = e.target as HTMLElement;
    if (ignoreSelector && target.closest(ignoreSelector)) return;

    startX.current = e.clientX;
    startY.current = e.clientY;
    pointerId.current = e.pointerId;
    captured.current = false;
    bailed.current = false;
    setAnimating(false);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== e.pointerId) return;
    if (removing || bailed.current) return;

    const deltaX = e.clientX - startX.current;
    const deltaY = e.clientY - startY.current;

    if (!captured.current) {
      if (Math.abs(deltaX) < ACTIVATE_PX && Math.abs(deltaY) < ACTIVATE_PX) {
        return;
      }
      // Decide direction exactly once per gesture. A swipe is a leftward
      // drag that clearly dominates the vertical movement; the 1.3×
      // ratio leaves diagonal/scroll gestures to the browser. Anything
      // else bails permanently so a later jitter can't start a swipe
      // mid-scroll.
      if (deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
        captured.current = true;
        innerRef.current?.setPointerCapture(e.pointerId);
      } else {
        bailed.current = true;
        return;
      }
    }

    // Light rubber-banding when pulled past the commit point.
    const limited = Math.min(0, deltaX);
    const damped =
      limited < -COMMIT_PX
        ? -COMMIT_PX + (limited + COMMIT_PX) * 0.4
        : limited;
    setDx(damped);
  }

  async function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== e.pointerId) return;
    if (!captured.current) {
      reset(false);
      return;
    }
    try {
      innerRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore — pointer may already be released
    }

    if (Math.abs(dx) >= COMMIT_PX) {
      const width = innerRef.current?.offsetWidth ?? 400;
      setRemoving(true);
      setAnimating(true);
      setDx(-width);
      window.setTimeout(() => {
        void onDelete();
      }, ANIMATE_MS);
    } else {
      reset(true);
    }
  }

  const innerStyle: CSSProperties = {
    transform: `translate3d(${dx}px, 0, 0)`,
    transition: animating ? `transform ${ANIMATE_MS}ms ease` : "none",
    touchAction: "pan-y",
  };

  const revealing = dx < 0;
  const committing = Math.abs(dx) >= COMMIT_PX;

  return (
    <div className={`swipe${className ? ` ${className}` : ""}`}>
      <div
        className={`swipe__bg${committing ? " swipe__bg--commit" : ""}`}
        aria-hidden={!revealing}
        // Hidden at rest so the red panel can't bleed past the row's
        // rounded corners while scrolling; only shown during an actual
        // leftward swipe.
        style={{ visibility: revealing ? "visible" : "hidden" }}
      >
        <TrashIcon />
        <span className="swipe__bg-label">Delete</span>
      </div>
      <div
        ref={innerRef}
        className="swipe__inner"
        style={innerStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}
