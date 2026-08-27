const REDACTED = '[redacted]';
const LOCAL_PATH = '[local-path]';
const MAX_STRING_LENGTH = 8_000;
const MAX_DEPTH = 6;
const MAX_COLLECTION_ITEMS = 100;

const SENSITIVE_KEY_RE =
  /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passcode|pin|secret|credential|cookie|private[_-]?key)/i;
const BEARER_RE = /(bearer\s+)[a-z0-9._~+/=-]+/gi;
const JWT_RE = /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi;
const QUERY_SECRET_RE =
  /([?&](?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|pin|secret)=)[^&#\s]+/gi;
const ASSIGNED_SECRET_RE =
  /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passcode|pin|secret|credential|cookie|private[_-]?key)["']?\s*[:=]\s*)(["']?)([^"',\s}\]]+)(["']?)/gi;
const WINDOWS_PATH_RE = /\b[a-z]:\\(?:[^\\\r\n]+\\)*[^\\\r\n\s"'<>]+/gi;
const UNIX_PATH_RE =
  /\/(?:Users|home|scratch|tmp|private|var\/folders|Volumes|mnt|data\/user)\/[^\s"'<>]+/g;

export function redactSensitiveText(value: string): string {
  const truncated =
    value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  return truncated
    .replace(BEARER_RE, `$1${REDACTED}`)
    .replace(JWT_RE, REDACTED)
    .replace(QUERY_SECRET_RE, `$1${REDACTED}`)
    .replace(ASSIGNED_SECRET_RE, `$1$2${REDACTED}$4`)
    .replace(WINDOWS_PATH_RE, LOCAL_PATH)
    .replace(UNIX_PATH_RE, LOCAL_PATH);
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number, key = ''): unknown {
  if (SENSITIVE_KEY_RE.test(key)) return REDACTED;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (depth >= MAX_DEPTH) return '[max-depth]';

  if (value instanceof Error) {
    return {
      name: redactSensitiveText(value.name),
      message: redactSensitiveText(value.message),
      ...(value.stack ? { stack: redactSensitiveText(value.stack) } : {}),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return redactSensitiveText(String(value));
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_ITEMS).map((item) => sanitizeValue(item, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const property of Object.keys(value).slice(0, MAX_COLLECTION_ITEMS)) {
    try {
      output[property] = sanitizeValue(
        (value as Record<string, unknown>)[property],
        seen,
        depth + 1,
        property,
      );
    } catch {
      output[property] = '[unavailable]';
    }
  }
  return output;
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet(), 0);
}

export function sanitizeLogMetadata(metadata?: unknown): Record<string, unknown> | undefined {
  if (metadata == null) return undefined;
  const sanitized = sanitizeLogValue(metadata);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return { value: sanitized };
}
