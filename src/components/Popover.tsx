import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface PopoverProps {
  label: ReactNode;
  title: string;
  children(close: () => void): ReactNode;
  align?: 'left' | 'right';
  badge?: ReactNode;
}

/** A button that toggles a panel, dismissed by Escape or an outside click. */
export function Popover({ label, title, children, align = 'right', badge }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="popover" ref={root}>
      <button
        type="button"
        className={`button${open ? ' button--active' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        {badge != null && <span className="button__badge">{badge}</span>}
      </button>
      {open && (
        <div
          className={`popover__panel popover__panel--${align}`}
          id={id}
          role="dialog"
          aria-label={title}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
