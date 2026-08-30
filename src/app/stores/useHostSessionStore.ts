import { create } from 'zustand';
import { platformApi } from '../platform';
import type { ServerStatus } from '../platform';
import { IS_DESKTOP } from '../types/platform';
import { logger } from '../services/logger';
import { useAuthStore } from './useAuthStore';
import { LOCAL_WORKSPACE_ID, useWorkspaceStore } from './useWorkspaceStore';

/**
 * The desktop handshake that has to succeed before a host-mode install is
 * usable at all: check whether the local workspace is active, wait for the
 * bundled server, then ask native code for a local session.
 *
 * It lives in a store rather than inside `useAutoLogin` because two callers
 * need it — the router drives it, and the login screen renders it — and
 * running the effect twice would mean two sign-in attempts against a server
 * that is still booting.
 */
export type HostSessionPhase =
  /** Not applicable: a web build, or a desktop install in client mode. */
  | 'idle'
  /** Asking the native bridge which mode this install is in. */
  | 'checking'
  /** The bundled server is booting. */
  | 'starting'
  /** The server answers; signing in with the stored PIN. */
  | 'connecting'
  /** Signed in. */
  | 'connected'
  /** Dead end — the reason is in `status.error` and/or `failure`. */
  | 'blocked';

export type HostLoginFailureKind =
  /** The server never answered — it is not listening where we expect it. */
  | 'unreachable'
  /** The server answered and refused the credentials — usually a changed PIN. */
  | 'rejected'
  | 'unknown';

export interface HostLoginFailure {
  kind: HostLoginFailureKind;
  message: string;
}

interface HostSessionState {
  phase: HostSessionPhase;
  status: ServerStatus | null;
  failure: HostLoginFailure | null;
  isHostMode: boolean;
  /** Idempotent: safe to call from every mount, starts the watch only once. */
  start: () => Promise<void>;
  /** Drop the status subscription. */
  stop: () => void;
  /** Leave the local-host state machine after selecting a remote workspace. */
  deactivate: () => void;
  /** Re-read the current server status and act on it. */
  refresh: () => Promise<void>;
  /** Ask the shell to (re)start the local server, then sign in. */
  retryHostStartup: () => Promise<void>;
  /** Ask native code to exchange the protected local PIN for a session. */
  signIn: () => Promise<void>;
  applyStatus: (status: ServerStatus) => Promise<void>;
  /** Test seam: forget the subscription and go back to the initial state. */
  reset: () => void;
}

/** How long `retryHostStartup` keeps waiting for a `starting` server. */
export const HOST_STARTUP_POLL_INTERVAL_MS = 500;
export const HOST_STARTUP_POLL_ATTEMPTS = 40;

let statusSubscription: (() => void) | null = null;
let startInFlight = false;
let signInInFlight = false;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Separate "the local server never answered" from "the local server answered
 * and said no". Both used to surface as one opaque `Auto-login failed`, which
 * left a wrong PIN and a dead sidecar looking identical.
 */
export function classifyLoginFailure(error: unknown): HostLoginFailure {
  const message = messageOf(error);
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed|econnrefused|fetch failed/i.test(
      message,
    )
  ) {
    return { kind: 'unreachable', message };
  }
  if (/pin|unauthor|invalid credential|login failed/i.test(message)) {
    return { kind: 'rejected', message };
  }
  return { kind: 'unknown', message };
}

export const useHostSessionStore = create<HostSessionState>((set, get) => ({
  // A desktop shell always begins by checking, so the login screen never
  // flashes a PIN form it is about to replace.
  phase: IS_DESKTOP ? 'checking' : 'idle',
  status: null,
  failure: null,
  isHostMode: false,

  reset: () => {
    statusSubscription?.();
    statusSubscription = null;
    startInFlight = false;
    signInInFlight = false;
    set({
      phase: IS_DESKTOP ? 'checking' : 'idle',
      status: null,
      failure: null,
      isHostMode: false,
    });
  },

  stop: () => {
    statusSubscription?.();
    statusSubscription = null;
  },

  deactivate: () => {
    statusSubscription?.();
    statusSubscription = null;
    startInFlight = false;
    signInInFlight = false;
    set({ phase: 'idle', status: null, failure: null, isHostMode: false });
  },

  start: async () => {
    if (!IS_DESKTOP) {
      set({ phase: 'idle', isHostMode: false });
      return;
    }
    if (statusSubscription || startInFlight) return;
    startInFlight = true;
    try {
      if (useWorkspaceStore.getState().activeWorkspaceId !== LOCAL_WORKSPACE_ID) {
        set({ phase: 'idle', isHostMode: false });
        return;
      }
      set({ isHostMode: true, phase: 'checking' });
      // Subscribe before the first status read so a sidecar that finishes
      // booting mid-check is still picked up.
      statusSubscription ??= platformApi.server.onStatusChange((status) => {
        void get().applyStatus(status);
      });
    } catch (error) {
      // No native server bridge (plain web build) — manual login applies.
      logger.debug('Host auto-login unavailable: no native server bridge', {
        error: messageOf(error),
      });
      set({ phase: 'idle', isHostMode: false });
      return;
    } finally {
      startInFlight = false;
    }
    await get().refresh();
  },

  refresh: async () => {
    try {
      const status = await platformApi.server.getStatus();
      await get().applyStatus(status);
    } catch (error) {
      const message = messageOf(error);
      logger.error('Could not read the local server status', error);
      set({ phase: 'blocked', failure: { kind: 'unknown', message } });
    }
  },

  // Async so that callers driving the handshake (`start`, `retryHostStartup`)
  // can await the sign-in it kicks off instead of racing it.
  applyStatus: async (status) => {
    set({ status });
    // Once this launch has completed its own handshake, repeated native
    // status notifications do not need to create more refresh sessions.
    // Before that point, a persisted token is not trusted: the local server
    // process may have restarted with a different signing key.
    if (get().phase === 'connected' && useAuthStore.getState().token) {
      return;
    }
    switch (status.state) {
      case 'starting':
        set({ phase: 'starting' });
        return;
      case 'running':
        await get().signIn();
        return;
      default:
        set({ phase: 'blocked' });
    }
  },

  signIn: async () => {
    if (signInInFlight) return;
    signInInFlight = true;
    set({ phase: 'connecting', failure: null });
    try {
      const status = get().status ?? (await platformApi.server.getStatus());
      const url = `http://localhost:${status.port}`;
      const session = await platformApi.server.issueLocalSession();
      useAuthStore.getState().adoptSession(url, session);
      set({ phase: 'connected', failure: null });
    } catch (error) {
      const failure = classifyLoginFailure(error);
      logger.error(`Desktop auto-login failed (${failure.kind})`, error);
      set({ phase: 'blocked', failure });
    } finally {
      signInInFlight = false;
    }
  },

  retryHostStartup: async () => {
    set({ phase: 'starting', failure: null });
    try {
      await platformApi.server.updateConfig({ localServerEnabled: true });
      set({ isHostMode: true });
      statusSubscription ??= platformApi.server.onStatusChange((status) => {
        void get().applyStatus(status);
      });
      const status = await waitForSettledStatus();
      await get().applyStatus(status);
    } catch (error) {
      const message = messageOf(error);
      logger.error('Could not start the local server', error);
      set({ phase: 'blocked', failure: { kind: 'unknown', message } });
    }
  },
}));

/**
 * Poll until the server stops reporting `starting`. The shell health-checks
 * the sidecar before it reports `running`, so an immediate login right after
 * the mode switch would race a server that has not bound its port yet.
 */
async function waitForSettledStatus(): Promise<ServerStatus> {
  let status = await platformApi.server.getStatus();
  for (
    let attempt = 1;
    status.state === 'starting' && attempt <= HOST_STARTUP_POLL_ATTEMPTS;
    attempt += 1
  ) {
    await delay(HOST_STARTUP_POLL_INTERVAL_MS);
    status = await platformApi.server.getStatus();
  }
  return status;
}
