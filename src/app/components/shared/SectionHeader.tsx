import { useState } from 'react';
import { ChevronRightIcon } from './Icons';

interface SectionHeaderProps {
  title: string;
  count?: number;
  variant?: 'default' | 'warning' | 'accent' | 'success';
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function SectionHeader({
  title,
  count,
  variant = 'default',
  defaultOpen = true,
  children,
}: SectionHeaderProps) {
  const [open, setOpen] = useState(defaultOpen);
  const variantClass = variant !== 'default' ? ` cc-section__header--${variant}` : '';

  return (
    <div className="cc-section">
      <button
        type="button"
        className={`cc-section__header${variantClass}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={`cc-section__chevron${open ? ' cc-section__chevron--open' : ''}`}
          size={16}
        />
        <span className="cc-section__title">{title}</span>
        {count != null && count > 0 && (
          <span className="cc-section__count">{count}</span>
        )}
      </button>
      {open && <div className="cc-section__body">{children}</div>}
    </div>
  );
}
