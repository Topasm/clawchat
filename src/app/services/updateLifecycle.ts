import { platformApi } from '../platform';
import type { UpdateInfo } from '../platform/nativePlatformTypes';
import {
  resetUpdateLifecycleState,
  type UpdateErrorAction,
  type UpdateLifecyclePatch,
  useUpdateStore,
} from '../stores/useUpdateStore';

const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FOCUS_CHECK_THROTTLE_MS = 60 * 60 * 1000;
const UP_TO_DATE_VISIBLE_MS = 4_000;

let initialized = false;
let checkRequest: Promise<void> | null = null;
let downloadRequest: Promise<void> | null = null;
let installRequest: Promise<void> | null = null;
let lastCheckAt = 0;
let interactiveCheck = false;
let upToDateTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupFunctions: Array<() => void> = [];

function setLifecycle(patch: UpdateLifecyclePatch) {
  useUpdateStore.getState().setLifecycle(patch);
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'The update operation could not be completed.';
}

function showError(action: UpdateErrorAction, error: unknown) {
  setLifecycle({
    status: 'error',
    error: readableError(error),
    errorAction: action,
  });
}

function showAvailable(info: UpdateInfo, force = false) {
  const store = useUpdateStore.getState();
  if (!force && store.dismissedVersion === info.version) {
    setLifecycle({ status: 'idle', info, error: null, errorAction: null });
    return;
  }
  if (store.dismissedVersion && store.dismissedVersion !== info.version) {
    store.dismissVersion(null);
  }
  setLifecycle({
    status: 'available',
    info,
    progress: null,
    error: null,
    errorAction: null,
  });
}

function showUpToDate() {
  setLifecycle({
    status: 'up-to-date',
    info: null,
    progress: null,
    error: null,
    errorAction: null,
  });
  if (upToDateTimer) clearTimeout(upToDateTimer);
  upToDateTimer = setTimeout(() => {
    if (useUpdateStore.getState().status === 'up-to-date') {
      setLifecycle({ status: 'idle' });
    }
  }, UP_TO_DATE_VISIBLE_MS);
}

/** Initializes one app-wide updater lifecycle and its periodic checks. */
export function initializeUpdateLifecycle() {
  if (initialized || !platformApi.runtime.isDesktop) return;
  initialized = true;

  cleanupFunctions = [
    platformApi.updater.onUpdateAvailable((info) => showAvailable(info, interactiveCheck)),
    platformApi.updater.onUpdateNotAvailable(() => {
      if (interactiveCheck) showUpToDate();
    }),
    platformApi.updater.onDownloadProgress((progress) => {
      setLifecycle({ status: 'downloading', progress, error: null, errorAction: null });
    }),
    platformApi.updater.onUpdateDownloaded(() => {
      setLifecycle({ status: 'ready', progress: null, error: null, errorAction: null });
    }),
  ];

  const periodicTimer = window.setInterval(() => {
    if (useUpdateStore.getState().automaticChecksEnabled) {
      void checkForAppUpdate(false);
    }
  }, PERIODIC_CHECK_INTERVAL_MS);
  cleanupFunctions.push(() => window.clearInterval(periodicTimer));

  const checkAfterResume = () => {
    const store = useUpdateStore.getState();
    if (
      document.visibilityState === 'visible'
      && store.automaticChecksEnabled
      && Date.now() - lastCheckAt >= FOCUS_CHECK_THROTTLE_MS
    ) {
      void checkForAppUpdate(false);
    }
  };
  window.addEventListener('online', checkAfterResume);
  document.addEventListener('visibilitychange', checkAfterResume);
  cleanupFunctions.push(() => window.removeEventListener('online', checkAfterResume));
  cleanupFunctions.push(() => document.removeEventListener('visibilitychange', checkAfterResume));

  if (useUpdateStore.getState().automaticChecksEnabled) {
    void checkForAppUpdate(false);
  }
}

export function checkForAppUpdate(interactive = true): Promise<void> {
  if (!platformApi.runtime.isDesktop) return Promise.resolve();
  if (checkRequest) {
    if (interactive) {
      interactiveCheck = true;
      setLifecycle({ status: 'checking', error: null, errorAction: null });
    }
    return checkRequest;
  }

  const status = useUpdateStore.getState().status;
  if (status === 'downloading' || status === 'ready' || status === 'restarting') {
    return Promise.resolve();
  }
  if (!interactive && (status === 'available' || status === 'error')) return Promise.resolve();

  interactiveCheck = interactive;
  if (interactive) {
    setLifecycle({ status: 'checking', error: null, errorAction: null });
  }

  checkRequest = platformApi.updater.checkForUpdates()
    .then((info) => {
      lastCheckAt = Date.now();
      if (info && useUpdateStore.getState().status !== 'ready') showAvailable(info, interactiveCheck);
      else if (interactiveCheck && useUpdateStore.getState().status === 'checking') showUpToDate();
    })
    .catch((error) => {
      if (interactiveCheck) showError('check', error);
      else {
        console.warn('Automatic update check failed:', error);
        if (useUpdateStore.getState().status === 'checking') setLifecycle({ status: 'idle' });
      }
    })
    .finally(() => {
      checkRequest = null;
      interactiveCheck = false;
    });
  return checkRequest;
}

export function downloadAppUpdate(): Promise<void> {
  if (downloadRequest) return downloadRequest;
  if (checkRequest) return checkRequest.then(() => downloadAppUpdate());
  if (useUpdateStore.getState().status !== 'available') return Promise.resolve();

  setLifecycle({
    status: 'downloading',
    progress: { downloadedBytes: 0 },
    error: null,
    errorAction: null,
  });
  downloadRequest = platformApi.updater.downloadUpdate()
    .then(() => {
      setLifecycle({ status: 'ready', progress: null, error: null, errorAction: null });
    })
    .catch((error) => showError('download', error))
    .finally(() => {
      downloadRequest = null;
    });
  return downloadRequest;
}

export function installAppUpdate(): Promise<void> {
  if (installRequest) return installRequest;
  if (downloadRequest) return downloadRequest.then(() => installAppUpdate());
  const store = useUpdateStore.getState();
  if (store.status !== 'ready' && !(store.status === 'error' && store.errorAction === 'install')) {
    return Promise.resolve();
  }

  setLifecycle({ status: 'restarting', error: null, errorAction: null });
  installRequest = platformApi.updater.installUpdate()
    .catch((error) => showError('install', error))
    .finally(() => {
      installRequest = null;
    });
  return installRequest;
}

export function retryAppUpdate() {
  const action = useUpdateStore.getState().errorAction;
  if (action === 'download') return downloadAppUpdateFromError();
  if (action === 'install') return installAppUpdate();
  return checkForAppUpdate(true);
}

function downloadAppUpdateFromError(): Promise<void> {
  setLifecycle({ status: 'available', error: null, errorAction: null });
  return downloadAppUpdate();
}

export function dismissAppUpdate() {
  const store = useUpdateStore.getState();
  if (store.status === 'available' && store.info) {
    store.dismissVersion(store.info.version);
  }
  if (store.status !== 'downloading' && store.status !== 'ready' && store.status !== 'restarting') {
    setLifecycle({ status: 'idle', error: null, errorAction: null, progress: null });
  }
}

export function setAutomaticUpdateChecks(enabled: boolean) {
  useUpdateStore.getState().setAutomaticChecksEnabled(enabled);
  if (enabled) void checkForAppUpdate(false);
}

export function resetUpdateLifecycleForTests() {
  cleanupFunctions.forEach((cleanup) => cleanup());
  cleanupFunctions = [];
  initialized = false;
  checkRequest = null;
  downloadRequest = null;
  installRequest = null;
  lastCheckAt = 0;
  interactiveCheck = false;
  if (upToDateTimer) clearTimeout(upToDateTimer);
  upToDateTimer = null;
  resetUpdateLifecycleState();
  useUpdateStore.setState({ automaticChecksEnabled: true, dismissedVersion: null });
}
