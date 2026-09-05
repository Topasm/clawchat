/** Opt-in, memory-only troubleshooting. Never capture bodies, headers, URLs or input text. */
export interface DebugEntry {
  time: string;
  event:
    | 'enabled'
    | 'request'
    | 'response'
    | 'network-failure'
    | 'ui-action'
    | 'runtime-error'
    | 'unhandled-rejection'
    | 'stream-start'
    | 'stream-headers'
    | 'stream-end'
    | 'stream-error'
    | 'stream-timeout'
    | 'stream-cancelled'
    | 'websocket-open'
    | 'websocket-close'
    | 'relay-response';
  resource?: string;
  method?: string;
  status?: number;
  durationMs?: number;
}

const RESOURCES = new Set([
  'projects',
  'todos',
  'tasks',
  'runs',
  'reviews',
  'conversations',
  'chat',
  'chats',
  'events',
  'inbox',
  'settings',
  'diagnostics',
  'auth',
  'health',
  'agents',
  'skills',
  'search',
  'attachments',
  'connections',
]);
export function debugResource(url = ''): string {
  // Keep only a known resource category; discard host, query, IDs and user-controlled segments.
  try {
    const parts = new URL(url, 'https://diagnostic.invalid').pathname.split('/').filter(Boolean);
    const name = parts[0] === 'api' ? parts[1] : parts[0];
    return RESOURCES.has(name) ? name : 'other';
  } catch {
    return 'other';
  }
}

let snapshot: { enabled: boolean; entries: readonly DebugEntry[] } = {
  enabled: false,
  entries: [],
};
const listeners = new Set<() => void>();
export const getDebugSnapshot = () => snapshot;
export function subscribeDebug(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish() {
  listeners.forEach((listener) => listener());
}
export function recordDebug(entry: Omit<DebugEntry, 'time'>) {
  if (!snapshot.enabled) return;
  snapshot = {
    ...snapshot,
    entries: [...snapshot.entries.slice(-499), { ...entry, time: new Date().toISOString() }],
  };
  publish();
}
function runtimeError() {
  recordDebug({ event: 'runtime-error', resource: debugResource(window.location.pathname) });
}
function rejection() {
  recordDebug({ event: 'unhandled-rejection', resource: debugResource(window.location.pathname) });
}
function interaction(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('[data-debug-controls]')) return;
  if (
    event.target instanceof Element &&
    event.target.closest('button,a,[role="button"],[role="switch"]')
  ) {
    recordDebug({ event: 'ui-action', resource: debugResource(window.location.pathname) });
  }
}
export function setDebugLogging(enabled: boolean) {
  if (snapshot.enabled === enabled) return;
  snapshot = { ...snapshot, enabled };
  if (typeof window !== 'undefined') {
    if (enabled) {
      window.addEventListener('error', runtimeError);
      window.addEventListener('unhandledrejection', rejection);
      window.addEventListener('click', interaction);
    } else {
      window.removeEventListener('error', runtimeError);
      window.removeEventListener('unhandledrejection', rejection);
      window.removeEventListener('click', interaction);
    }
  }
  if (enabled) recordDebug({ event: 'enabled' });
  else publish();
}
export function clearDebugLogs() {
  snapshot = { ...snapshot, entries: [] };
  publish();
}

export function serializeDebugLogs(runtime: { os: string; appVersion: string; kind: string }) {
  return JSON.stringify(
    {
      format: 1,
      exportedAt: new Date().toISOString(),
      runtime,
      scope:
        'Renderer interactions, API transport and runtime error signals. No server stdout or request bodies.',
      entries: snapshot.entries,
    },
    null,
    2,
  );
}
