interface IconProps {
  size?: number;
  className?: string;
}

export function CalendarIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" />
      <path d="M2.5 7.5h13" />
      <path d="M6 2v3M12 2v3" strokeLinecap="round" />
      <circle cx="6.5" cy="11" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="9" cy="11" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="11" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MemoIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M14 2.5H4a1.5 1.5 0 00-1.5 1.5v10a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5V4A1.5 1.5 0 0014 2.5z" />
      <path d="M6 6.5h6M6 9.5h6M6 12.5h3" strokeLinecap="round" />
    </svg>
  );
}
