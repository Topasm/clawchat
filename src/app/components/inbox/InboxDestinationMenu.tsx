import { useEffect, useRef, useState, type ReactNode } from 'react';
import { translateUi } from '../../i18n';

export interface InboxDestinationOption {
  key: string;
  label: string;
  current?: boolean;
  onSelect: () => void;
}

interface InboxDestinationMenuProps {
  /** What the button says: where the item is now. */
  children: ReactNode;
  options: InboxDestinationOption[];
  disabled?: boolean;
}

/**
 * Where an organized item went, as a button. Pressing it offers the other
 * places (task, note, a project) instead of a row of buttons on every item.
 */
export default function InboxDestinationMenu({
  children,
  options,
  disabled,
}: InboxDestinationMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="cc-inbox-dest" ref={rootRef}>
      <button
        type="button"
        className="cc-inbox-dest__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={translateUi('Change where this goes')}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </button>
      {open && (
        <div className="cc-inbox-dest__menu" role="menu">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="menuitemradio"
              aria-checked={option.current ?? false}
              disabled={option.current}
              onClick={() => {
                setOpen(false);
                option.onSelect();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
