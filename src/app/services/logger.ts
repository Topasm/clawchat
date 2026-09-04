import { redactSensitiveText, sanitizeLogMetadata, sanitizeLogValue } from './sensitiveData';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  stack?: string;
}

const MAX_ENTRIES = 200;
const LEGACY_STORAGE_KEY = 'clawchat-logs';
const STORAGE_KEY = 'clawchat-logs:v2';
const FLUSH_INTERVAL_MS = 30_000;

function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LogEntry>;
  return (
    typeof candidate.timestamp === 'string' &&
    ['debug', 'info', 'warn', 'error'].includes(candidate.level ?? '') &&
    typeof candidate.message === 'string'
  );
}

export class Logger {
  private entries: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.restoreSanitizedEntries();
    this.startAutoFlush();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
    }
  }

  log(level: LogLevel, message: string, metadata?: unknown): void {
    const safeMessage = redactSensitiveText(message);
    const normalizedMetadata = sanitizeLogMetadata(metadata);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: safeMessage,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
    };
    this.push(entry);
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](
      `[${entry.timestamp}] [${level.toUpperCase()}] ${safeMessage}`,
      normalizedMetadata ?? '',
    );
  }

  error(message: string, error?: unknown, metadata?: unknown): void {
    const safeMessage = redactSensitiveText(message);
    const safeError = error == null ? undefined : sanitizeLogValue(error);
    const stack =
      safeError &&
      typeof safeError === 'object' &&
      'stack' in safeError &&
      typeof safeError.stack === 'string'
        ? safeError.stack
        : undefined;
    const normalizedMetadata = sanitizeLogMetadata({
      ...(metadata == null ? {} : { context: metadata }),
      ...(safeError == null ? {} : { error: safeError }),
    });
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: safeMessage,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
      ...(stack ? { stack } : {}),
    };
    this.push(entry);
    console.error(`[${entry.timestamp}] [ERROR] ${safeMessage}`, normalizedMetadata ?? '');
  }

  warn(message: string, metadata?: unknown): void {
    this.log('warn', message, metadata);
  }

  info(message: string, metadata?: unknown): void {
    this.log('info', message, metadata);
  }

  debug(message: string, metadata?: unknown): void {
    this.log('debug', message, metadata);
  }

  flush(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage full or unavailable — silently ignore
    }
  }

  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  dispose(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
  }

  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private restoreSanitizedEntries(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      this.entries = parsed
        .slice(-MAX_ENTRIES)
        .map((entry) => sanitizeLogValue(entry))
        .filter(isLogEntry);
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage unavailable.
      }
    }
  }
}

export const logger = new Logger();
