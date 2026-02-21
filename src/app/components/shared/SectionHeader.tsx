import { useState } from 'react';

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
      <div
        className={`cc-section__header${variantClass}`}
        onClick={() => setOpen(!open)}
      >
        <svg
          className={`cc-section__chevron${open ? ' cc-section__chevron--open' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
        >
          <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="cc-section__title">{title}</span>
        {count != null && count > 0 && (
          <span className="cc-section__count">{count}</span>
        )}
      </div>
      {open && <div className="cc-section__body">{children}</div>}
    </div>
  );
}
