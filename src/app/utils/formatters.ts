import { getAppLanguage, translateUi } from '../i18n';

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(getAppLanguage() === 'ko' ? 'ko-KR' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString(getAppLanguage() === 'ko' ? 'ko-KR' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDateTime(dateString: string): string {
  return translateUi('{{date}} at {{time}}', {
    date: formatDate(dateString),
    time: formatTime(dateString),
  });
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return translateUi('just now');
  if (diffMinutes < 60)
    return translateUi(diffMinutes === 1 ? '1 minute ago' : '{{count}} minutes ago', {
      count: diffMinutes,
    });
  if (diffHours < 24)
    return translateUi(diffHours === 1 ? '1 hour ago' : '{{count}} hours ago', {
      count: diffHours,
    });
  if (diffDays === 1) return translateUi('yesterday');
  if (diffDays < 7) return translateUi('{{count}} days ago', { count: diffDays });
  return formatDate(dateString);
}

export function truncate(text: string, maxLength = 50): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function isToday(dateString: string): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function isTomorrow(dateString: string): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  );
}

export function isOverdue(dateString: string): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date < now;
}

export function formatDueDate(dateString: string): string {
  if (!dateString) return '';
  if (isToday(dateString)) return translateUi('Today');
  if (isTomorrow(dateString)) return translateUi('Tomorrow');
  if (isOverdue(dateString)) return translateUi('Overdue');
  return formatDate(dateString);
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return translateUi('Good morning');
  if (hour < 17) return translateUi('Good afternoon');
  return translateUi('Good evening');
}

export function formatShortDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatDateTimeShort(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return translateUi('just now');
  if (m < 60) return translateUi('{{count}}m ago', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return translateUi('{{count}}h ago', { count: h });
  const d = Math.floor(h / 24);
  return translateUi('{{count}}d ago', { count: d });
}
