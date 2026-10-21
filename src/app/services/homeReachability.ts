import { useAuthStore } from '../stores/useAuthStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { activeWorkspaceName } from '../utils/workspaceLocation';
import { translateUi } from '../i18n';

/** A connection that drops for less than this is not an outage. */
export const OUTAGE_GRACE_MS = 4000;

/** When the socket to Home last stopped being connected, or null while it is. */
let lostAt: number | null = null;
let tracking = false;

/**
 * Starts following the socket the first time anyone asks. A socket that is
 * not connected yet at that point gets the same grace as a blink, so a fresh
 * app is not called offline while it opens.
 */
function track(now: number): void {
  if (tracking) return;
  tracking = true;
  if (useAuthStore.getState().connectionStatus !== 'connected') lostAt = now;
  useAuthStore.subscribe((state, previous) => {
    if (state.connectionStatus === previous.connectionStatus) return;
    if (state.connectionStatus === 'connected') lostAt = null;
    else lostAt ??= Date.now();
  });
}

/**
 * How much longer a socket that is opening, or blinking, still counts as
 * reachable; 0 when it is connected or already out of grace.
 */
export function homeGraceLeft(now = Date.now()): number {
  track(now);
  return lostAt === null ? 0 : Math.max(0, lostAt + OUTAGE_GRACE_MS - now);
}

/**
 * Whether Home can take work right now, as the offline banner and every
 * hand-off read it: the browser is online and the socket is connected, or
 * dropped less than OUTAGE_GRACE_MS ago.
 */
export function isHomeReachableNow(now = Date.now()): boolean {
  if (!navigator.onLine) return false;
  track(now);
  const { serverUrl, connectionStatus } = useAuthStore.getState();
  if (!serverUrl || connectionStatus === 'connected') return true;
  return homeGraceLeft(now) > 0;
}

/** Work that would start on Home was held back because Home is out of reach. */
export class HomeUnreachableError extends Error {
  constructor() {
    super('Home is unreachable');
    this.name = 'HomeUnreachableError';
  }
}

/** "Reconnect to ‹workspace› to hand this to AI". */
export function homeUnreachableMessage(): string {
  return translateUi('Reconnect to {{workspace}} to hand this to AI', {
    workspace: activeWorkspaceName(useWorkspaceStore.getState()),
  });
}

/**
 * Called first by every mutation that starts AI work on Home (a run, a retry,
 * a resume): checking and adding keep working offline, handing work over
 * waits for the connection.
 */
export function requireHome(): void {
  if (!isHomeReachableNow()) throw new HomeUnreachableError();
}
