import { CalendarIcon, IconBase, SettingsIcon } from './Icons';
import type { IconProps } from './Icons';

function navClassName(className?: string) {
  return ['cc-nav-icon', className].filter(Boolean).join(' ');
}

export function SunIcon({ size, className, label }: IconProps = {}) {
  return (
    <IconBase size={size} className={navClassName(className)} label={label}>
      <circle cx="9" cy="9" r="3.5" />
      <path
        d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

export function InboxIcon({ size, className, label }: IconProps = {}) {
  return (
    <IconBase size={size} className={navClassName(className)} label={label}>
      <path d="M2.5 10h4l1 2h3l1-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4.1 4.5L2.5 10v4a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-4l-1.6-5.5A1.5 1.5 0 0012.5 3h-7a1.5 1.5 0 00-1.4 1.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function ChatIcon({ size, className, label }: IconProps = {}) {
  return (
    <IconBase size={size} className={navClassName(className)} label={label}>
      <path
        d="M16 12a1.5 1.5 0 01-1.5 1.5H5L2 16.5V4A1.5 1.5 0 013.5 2.5h11A1.5 1.5 0 0116 4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function NavCalendarIcon({ size, className, label }: IconProps = {}) {
  return <CalendarIcon size={size} className={navClassName(className)} label={label} />;
}

export function TasksIcon({ size, className, label }: IconProps = {}) {
  return (
    <IconBase size={size} className={navClassName(className)} label={label}>
      <path d="M3 4.5h12M3 9h12M3 13.5h12" strokeLinecap="round" />
    </IconBase>
  );
}

export function ReviewIcon({ size, className, label }: IconProps = {}) {
  return (
    <IconBase size={size} className={navClassName(className)} label={label}>
      <rect x="3" y="3" width="12" height="12" rx="2" />
      <path d="M6 9l2 2 4-4" />
    </IconBase>
  );
}

export function RunsIcon({ size, className, label }: IconProps = {}) {
  return (
    <IconBase size={size} className={navClassName(className)} label={label}>
      <path d="M4 3.5l10 5.5-10 5.5z" />
      <path d="M14.5 3v12" />
    </IconBase>
  );
}

export function GearIcon({ size, className, label }: IconProps = {}) {
  return <SettingsIcon size={size} className={navClassName(className)} label={label} />;
}

export function AdminIcon({ size, className, label }: IconProps = {}) {
  return (
    <IconBase size={size} className={navClassName(className)} label={label}>
      <path
        d="M9 1.5L2.5 5v4c0 4.1 2.8 7.3 6.5 8 3.7-.7 6.5-3.9 6.5-8V5L9 1.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function SearchIcon({ size, className, label }: IconProps = {}) {
  return (
    <IconBase size={size} className={navClassName(className)} label={label}>
      <circle cx="8" cy="8" r="5" />
      <path d="M15.5 15.5l-3.6-3.6" strokeLinecap="round" />
    </IconBase>
  );
}
