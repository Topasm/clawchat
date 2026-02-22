type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  stack?: string;
}

const MAX_ENTRIES = 200;
const STORAGE_KEY = 'clawchat-logs';
const FLUSH_INTERVAL_MS = 30_000;

class Logger {
  private entries: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startAutoFlush();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
    }
  }

  log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(metadata ? { metadata } : {}),
    };
    this.push(entry);
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](
      `[${entry.timestamp}] [${level.toUpperCase()}] ${message}`,
      metadata ?? '',
    );
  }

  error(message: string, error?: unknown, metadata?: Record<string, unknown>): void {
    const stack = error instanceof Error ? error.stack : undefined;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      ...(metadata ? { metadata } : {}),
      ...(stack ? { stack } : {}),
    };
    this.push(entry);
    // eslint-disable-next-line no-console
    console.error(`[${entry.timestamp}] [ERROR] ${message}`, error ?? '', metadata ?? '');
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, metadata);
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, metadata);
  }

  flush(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage full or unavailable — silently ignore
    }
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
}

export const logger = new Logger();
export default logger;
