import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  storageKey: string;
}

const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.8;

/**
 * Two panes with a draggable divider. Below 900px the panes stack and the
 * divider is inert, which the CSS handles; the stored fraction is kept so the
 * layout comes back when the window widens again.
 */
export function SplitPane({ left, right, storageKey }: SplitPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = useState(() => readStored(storageKey));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(fraction));
    } catch {
      // Private browsing; the layout just won't persist.
    }
  }, [fraction, storageKey]);

  const moveTo = useCallback((clientX: number) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) {
      return;
    }
    const next = (clientX - bounds.left) / bounds.width;
    setFraction(Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, next)));
  }, []);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (event: PointerEvent) => {
      event.preventDefault();
      moveTo(event.clientX);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, moveTo]);

  const nudge = (delta: number) =>
    setFraction((current) =>
      Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, current + delta)),
    );

  return (
    <div
      className={`split${dragging ? ' split--dragging' : ''}`}
      ref={container}
      style={{ ['--split-fraction' as string]: fraction }}
    >
      <div className="split__pane">{left}</div>
      <div
        className="split__divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={Math.round(MIN_FRACTION * 100)}
        aria-valuemax={Math.round(MAX_FRACTION * 100)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => setFraction(0.5)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudge(-0.02);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudge(0.02);
          } else if (event.key === 'Home') {
            event.preventDefault();
            setFraction(0.5);
          }
        }}
      >
        <span className="split__grip" aria-hidden="true" />
      </div>
      <div className="split__pane">{right}</div>
    </div>
  );
}

function readStored(key: string): number {
  try {
    const stored = Number(localStorage.getItem(key));
    if (Number.isFinite(stored) && stored >= MIN_FRACTION && stored <= MAX_FRACTION) {
      return stored;
    }
  } catch {
    // ignore
  }
  return 0.45;
}
