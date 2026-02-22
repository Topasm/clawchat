import { CalendarIcon, MemoIcon } from './Icons';

export function SunIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="3.5" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" strokeLinecap="round" />
    </svg>
  );
}

export function InboxIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 10h4l1 2h3l1-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.1 4.5L2.5 10v4a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-4l-1.6-5.5A1.5 1.5 0 0012.5 3h-7a1.5 1.5 0 00-1.4 1.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M16 12a1.5 1.5 0 01-1.5 1.5H5L2 16.5V4A1.5 1.5 0 013.5 2.5h11A1.5 1.5 0 0116 4z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NavCalendarIcon() {
  return <CalendarIcon className="cc-nav-icon" />;
}

export function TasksIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4.5h12M3 9h12M3 13.5h12" strokeLinecap="round" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M14.7 11.2a1.2 1.2 0 00.2 1.3l.04.04a1.44 1.44 0 11-2.04 2.04l-.04-.04a1.2 1.2 0 00-1.3-.2 1.2 1.2 0 00-.73 1.1v.12a1.44 1.44 0 11-2.88 0v-.06a1.2 1.2 0 00-.78-1.1 1.2 1.2 0 00-1.3.2l-.04.04a1.44 1.44 0 11-2.04-2.04l.04-.04a1.2 1.2 0 00.2-1.3 1.2 1.2 0 00-1.1-.73H3.45a1.44 1.44 0 110-2.88h.06a1.2 1.2 0 001.1-.78 1.2 1.2 0 00-.2-1.3l-.04-.04A1.44 1.44 0 116.41 3.43l.04.04a1.2 1.2 0 001.3.2h.06a1.2 1.2 0 00.73-1.1V2.45a1.44 1.44 0 012.88 0v.06a1.2 1.2 0 00.73 1.1 1.2 1.2 0 001.3-.2l.04-.04a1.44 1.44 0 112.04 2.04l-.04.04a1.2 1.2 0 00-.2 1.3v.06a1.2 1.2 0 001.1.73h.12a1.44 1.44 0 010 2.88h-.06a1.2 1.2 0 00-1.1.73z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NavMemoIcon() {
  return <MemoIcon className="cc-nav-icon" />;
}

export function AdminIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 1.5L2.5 5v4c0 4.1 2.8 7.3 6.5 8 3.7-.7 6.5-3.9 6.5-8V5L9 1.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5" />
      <path d="M15.5 15.5l-3.6-3.6" strokeLinecap="round" />
    </svg>
  );
}
