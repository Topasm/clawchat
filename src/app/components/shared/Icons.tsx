import type { CSSProperties, ReactNode } from 'react';

/** Semantic sizes shared by navigation, controls, features, and empty states. */
export const ICON_SIZE = {
  micro: 12,
  compact: 14,
  control: 16,
  feature: 18,
  empty: 28,
} as const;

/** Default stroke shared by ClawChat's line icons. */
export const ICON_STROKE_WIDTH = 1.75;

export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Provide only when the icon itself carries meaning. Most icons are decorative. */
  label?: string;
}

interface IconBaseProps extends IconProps {
  children: ReactNode;
  strokeWidth?: number;
}

/** Shared geometry and accessibility contract for ClawChat's line icon set. */
export function IconBase({
  children,
  size = ICON_SIZE.feature,
  className,
  style,
  label,
  strokeWidth = ICON_STROKE_WIDTH,
}: IconBaseProps) {
  const classes = ['cc-icon', className].filter(Boolean).join(' ');

  return (
    <svg
      width={size}
      height={size}
      className={classes}
      style={style}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function CalendarIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" />
      <path d="M2.5 7.5h13" />
      <path d="M6 2v3M12 2v3" strokeLinecap="round" />
      <circle cx="6.5" cy="11" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="9" cy="11" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="11" r="0.75" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function MemoIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M14 2.5H4a1.5 1.5 0 00-1.5 1.5v10a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5V4A1.5 1.5 0 0014 2.5z" />
      <path d="M6 6.5h6M6 9.5h6M6 12.5h3" strokeLinecap="round" />
    </IconBase>
  );
}

export function ClipboardIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <rect
        x="4"
        y="3.5"
        width="10"
        height="12.5"
        rx="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7 2.5h4a1 1 0 011 1v1H6v-1a1 1 0 011-1z" strokeLinejoin="round" />
      <path d="M7 8h4M7 10.5h4M7 13h2" strokeLinecap="round" />
    </IconBase>
  );
}

export function SpinArrowsIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M14.5 9A5.5 5.5 0 004.3 5.5" strokeLinecap="round" />
      <path d="M3.5 9a5.5 5.5 0 0010.2 3.5" strokeLinecap="round" />
      <path d="M4.3 2.5v3h3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.7 15.5v-3h-3" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function CheckCircleIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function SparkleIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path
        d="M9 2v2.5M9 13.5V16M2 9h2.5M13.5 9H16M4.1 4.1l1.8 1.8M12.1 12.1l1.8 1.8M13.9 4.1l-1.8 1.8M5.9 12.1l-1.8 1.8"
        strokeLinecap="round"
      />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function ChatBubbleIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path
        d="M16 12a1.5 1.5 0 01-1.5 1.5H5L2 16.5V4A1.5 1.5 0 013.5 2.5h11A1.5 1.5 0 0116 4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 7h6M6 10h3" strokeLinecap="round" />
    </IconBase>
  );
}

export function FlameIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path
        d="M9 1.5c0 3-3 4.5-3 7.5a4.5 4.5 0 009 0c0-3.5-2.5-5-3-7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 16.5a2 2 0 01-2-2c0-1.5 2-3 2-3s2 1.5 2 3a2 2 0 01-2 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function MagnifyingGlassIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <circle cx="8" cy="8" r="5" />
      <path d="M15.5 15.5l-3.6-3.6" strokeLinecap="round" />
    </IconBase>
  );
}

export function InboxTrayIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M2.5 10h4l1 2h3l1-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4.1 4.5L2.5 10v4a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-4l-1.6-5.5A1.5 1.5 0 0012.5 3h-7a1.5 1.5 0 00-1.4 1.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 5v4M7 7.5l2 2 2-2" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function CloseIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
    </IconBase>
  );
}

export function CheckIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M3.5 9.5l3.5 3.5 7.5-8" />
    </IconBase>
  );
}

export function InfoIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 8v4" />
      <circle cx="9" cy="5.5" r=".75" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function WarningIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M8 2.8L1.9 13.4A1.2 1.2 0 003 15.2h12a1.2 1.2 0 001.1-1.8L10 2.8a1.2 1.2 0 00-2 0z" />
      <path d="M9 6.5v4" />
      <circle cx="9" cy="13" r=".7" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function PinIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M6 3h6l-1 4 2.5 2.5v1H4.5v-1L7 7 6 3zM9 10.5V16" />
    </IconBase>
  );
}

export function ThemeIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M14.8 11.3A6.2 6.2 0 016.7 3.2 6.2 6.2 0 1014.8 11.3z" />
    </IconBase>
  );
}

export function SettingsIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <circle cx="9" cy="9" r="2.5" />
      <path d="M14.7 11.2a1.2 1.2 0 00.2 1.3l.04.04a1.44 1.44 0 11-2.04 2.04l-.04-.04a1.2 1.2 0 00-1.3-.2 1.2 1.2 0 00-.73 1.1v.12a1.44 1.44 0 11-2.88 0v-.06a1.2 1.2 0 00-.78-1.1 1.2 1.2 0 00-1.3.2l-.04.04a1.44 1.44 0 11-2.04-2.04l.04-.04a1.2 1.2 0 00.2-1.3 1.2 1.2 0 00-1.1-.73H3.45a1.44 1.44 0 110-2.88h.06a1.2 1.2 0 001.1-.78 1.2 1.2 0 00-.2-1.3l-.04-.04A1.44 1.44 0 116.41 3.43l.04.04a1.2 1.2 0 001.3.2h.06a1.2 1.2 0 00.73-1.1V2.45a1.44 1.44 0 012.88 0v.06a1.2 1.2 0 00.73 1.1 1.2 1.2 0 001.3-.2l.04-.04a1.44 1.44 0 112.04 2.04l-.04.04a1.2 1.2 0 00-.2 1.3v.06a1.2 1.2 0 001.1.73h.12a1.44 1.44 0 010 2.88h-.06a1.2 1.2 0 00-1.1.73z" />
    </IconBase>
  );
}

export function LinkIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M7.2 10.8l3.6-3.6M6 12H4.8a3.3 3.3 0 010-6.6H7M12 6h1.2a3.3 3.3 0 010 6.6H11" />
    </IconBase>
  );
}

export function PlugIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M6 2.5v4M12 2.5v4M4.5 6.5h9v1A4.5 4.5 0 019 12v3.5M6.5 15.5h5" />
    </IconBase>
  );
}

export function RobotIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <rect x="3" y="5.5" width="12" height="9" rx="2" />
      <path d="M9 2v3.5M6.5 9h.01M11.5 9h.01M6.5 12h5" />
    </IconBase>
  );
}

export function FolderIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M2.5 5a1.5 1.5 0 011.5-1.5h3l1.5 2H14A1.5 1.5 0 0115.5 7v6A1.5 1.5 0 0114 14.5H4A1.5 1.5 0 012.5 13V5z" />
    </IconBase>
  );
}

export function ChartIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M3 15.5V9.5h3v6M7.5 15.5v-13h3v13M12 15.5v-9h3v9M2 15.5h14" />
    </IconBase>
  );
}

export function DatabaseIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <ellipse cx="9" cy="4.5" rx="6" ry="2.5" />
      <path d="M3 4.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4M3 8.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4" />
    </IconBase>
  );
}

export function ChevronLeftIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M11.5 4.5L7 9l4.5 4.5" />
    </IconBase>
  );
}

export function ChevronRightIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M6.5 4.5L11 9l-4.5 4.5" />
    </IconBase>
  );
}

export function CopyIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
      <path d="M11.5 6.5V4.5A2 2 0 009.5 2.5h-5a2 2 0 00-2 2v5a2 2 0 002 2h2" />
    </IconBase>
  );
}

export function EditIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M12.5 2.5l3 3M3 15l.7-3.2L13.5 2l3 3-9.8 10H3z" />
    </IconBase>
  );
}

export function TrashIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M2.5 5h13M7 5V3.5A1.5 1.5 0 018.5 2h1A1.5 1.5 0 0111 3.5V5M14 5l-.8 10H4.8L4 5M7 8v4.5M11 8v4.5" />
    </IconBase>
  );
}

export function UserIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <circle cx="9" cy="6" r="3.25" />
      <path d="M3 16c0-3.5 2.7-5.8 6-5.8s6 2.3 6 5.8" />
    </IconBase>
  );
}

export function StopIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <rect x="4" y="4" width="10" height="10" rx="1.25" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function MicrophoneIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <rect x="6" y="2" width="6" height="9" rx="3" />
      <path d="M4 8a5 5 0 0010 0M9 13v3M6.5 16h5" />
    </IconBase>
  );
}

export function SendIcon({ size = ICON_SIZE.feature, className, label }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label}>
      <path d="M16 2L8 10M16 2l-5 14-3-6-6-3 14-5z" />
    </IconBase>
  );
}

export function PlusIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M9 3v12M3 9h12" />
    </IconBase>
  );
}

export function MinusIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M3 9h12" />
    </IconBase>
  );
}

export function ArrowRightIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M3 9h12M11 5l4 4-4 4" />
    </IconBase>
  );
}

export function ArrowDownIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M9 3v12M5 11l4 4 4-4" />
    </IconBase>
  );
}

export function ExternalLinkIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M10 3h5v5M15 3L8 10" />
      <path d="M8 4H4.5A1.5 1.5 0 003 5.5v8A1.5 1.5 0 004.5 15h8a1.5 1.5 0 001.5-1.5V10" />
    </IconBase>
  );
}

export function ExpandIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M7 3H3v4M11 3h4v4M7 15H3v-4M11 15h4v-4" />
      <path d="M3 7l4-4M15 7l-4-4M3 11l4 4M15 11l-4 4" />
    </IconBase>
  );
}

export function CollapseIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M2.5 6.5h4v-4M15.5 6.5h-4v-4M2.5 11.5h4v4M15.5 11.5h-4v4" />
      <path d="M6.5 6.5l-4-4M11.5 6.5l4-4M6.5 11.5l-4 4M11.5 11.5l4 4" />
    </IconBase>
  );
}

export function RepeatIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M2 5h13M2 5l3-3M2 5l3 3M16 13H3M16 13l-3-3M16 13l-3 3" />
    </IconBase>
  );
}

export function RefreshIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M15 6A6.5 6.5 0 103.2 12M15 2.5V6h-3.5" />
    </IconBase>
  );
}

export function WifiOffIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <path d="M2 2l14 14M6 6a8 8 0 018.5 1.6M3.5 8.5A8 8 0 015 7.3M7 11a3.5 3.5 0 014.5.3" />
      <circle cx="9" cy="15" r="0.75" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function GripIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style} strokeWidth={0}>
      {[4, 9, 14].flatMap((y) =>
        [5.5, 12.5].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.35" fill="currentColor" />
        )),
      )}
    </IconBase>
  );
}

export function GraphIcon({ size = ICON_SIZE.feature, className, label, style }: IconProps) {
  return (
    <IconBase size={size} className={className} label={label} style={style}>
      <rect x="1.5" y="6.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="11.5" width="5" height="5" rx="1" />
      <path d="M6.5 9h2c2 0 1.5-5 3-5M8.5 9c2 0 1.5 5 3 5" />
    </IconBase>
  );
}
