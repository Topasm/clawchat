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

  private normalizeMetadata(metadata?: unknown): Record<string, unknown> | undefined {
    if (metadata == null) return undefined;
    if (metadata instanceof Error) {
      return {
        name: metadata.name,
        message: metadata.message,
        ...(metadata.stack ? { stack: metadata.stack } : {}),
      };
    }
    if (typeof metadata === 'object') {
      return metadata as Record<string, unknown>;
    }
    return { value: metadata };
  }

  log(level: LogLevel, message: string, metadata?: unknown): void {
    const normalizedMetadata = this.normalizeMetadata(metadata);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
    };
    this.push(entry);
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](
      `[${entry.timestamp}] [${level.toUpperCase()}] ${message}`,
      normalizedMetadata ?? '',
    );
  }

  error(message: string, error?: unknown, metadata?: unknown): void {
    const stack = error instanceof Error ? error.stack : undefined;
    const normalizedMetadata = this.normalizeMetadata(metadata);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
      ...(stack ? { stack } : {}),
    };
    this.push(entry);
    // eslint-disable-next-line no-console
    console.error(`[${entry.timestamp}] [ERROR] ${message}`, error ?? '', normalizedMetadata ?? '');
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
