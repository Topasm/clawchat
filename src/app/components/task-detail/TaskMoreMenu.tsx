import { useEffect, useRef, useState } from 'react';
import { translateUi } from '../../i18n';

export interface TaskMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** The ⋮ next to a task's title: actions that are not the next step. */
export default function TaskMoreMenu({ items }: { items: TaskMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="cc-task-menu" ref={rootRef}>
      <button
        type="button"
        className="cc-btn cc-btn--ghost cc-task-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={translateUi('More actions')}
        onClick={() => setOpen((value) => !value)}
      >
        ⋮
      </button>
      {open && (
        <div className="cc-task-menu__popover" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={item.danger ? 'cc-task-menu__item--danger' : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
