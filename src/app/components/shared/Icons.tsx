export interface IconProps {
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

export function ClipboardIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="3.5" width="10" height="12.5" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 2.5h4a1 1 0 011 1v1H6v-1a1 1 0 011-1z" strokeLinejoin="round" />
      <path d="M7 8h4M7 10.5h4M7 13h2" strokeLinecap="round" />
    </svg>
  );
}

export function SpinArrowsIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14.5 9A5.5 5.5 0 004.3 5.5" strokeLinecap="round" />
      <path d="M3.5 9a5.5 5.5 0 0010.2 3.5" strokeLinecap="round" />
      <path d="M4.3 2.5v3h3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.7 15.5v-3h-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="6.5" />
      <path d="M6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkleIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 2v2.5M9 13.5V16M2 9h2.5M13.5 9H16M4.1 4.1l1.8 1.8M12.1 12.1l1.8 1.8M13.9 4.1l-1.8 1.8M5.9 12.1l-1.8 1.8" strokeLinecap="round" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChatBubbleIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M16 12a1.5 1.5 0 01-1.5 1.5H5L2 16.5V4A1.5 1.5 0 013.5 2.5h11A1.5 1.5 0 0116 4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 7h6M6 10h3" strokeLinecap="round" />
    </svg>
  );
}

export function FlameIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 1.5c0 3-3 4.5-3 7.5a4.5 4.5 0 009 0c0-3.5-2.5-5-3-7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 16.5a2 2 0 01-2-2c0-1.5 2-3 2-3s2 1.5 2 3a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MagnifyingGlassIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5" />
      <path d="M15.5 15.5l-3.6-3.6" strokeLinecap="round" />
    </svg>
  );
}

export function InboxTrayIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 10h4l1 2h3l1-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.1 4.5L2.5 10v4a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-4l-1.6-5.5A1.5 1.5 0 0012.5 3h-7a1.5 1.5 0 00-1.4 1.5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 5v4M7 7.5l2 2 2-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
