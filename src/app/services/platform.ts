import { platformApi } from '../platform';
import { IS_DESKTOP } from '../types/platform';

export interface NotifyOptions {
  /** Silent notification (no sound). Defaults to false. */
  silent?: boolean;
  /** Item type for action buttons (todo or event). */
  itemType?: 'todo' | 'event';
  /** Item ID for action buttons — enables "Mark Done" action. */
  itemId?: string;
}

/**
 * Cross-platform desktop notification with optional action buttons.
 * - Tauri: uses the native notification command
 * - Web: uses the browser Notification API
 *
 * When itemType + itemId are provided, a "Mark Done" action button is shown.
 */
export async function notify(
  title: string,
  body: string,
  options: NotifyOptions = {},
): Promise<void> {
  const { silent = false, itemType, itemId } = options;

  if (IS_DESKTOP) {
    await platformApi.notifications.show(title, body, { silent, itemType, itemId });
  } else if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      showWebNotification(title, body, { silent, itemType, itemId });
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') showWebNotification(title, body, { silent, itemType, itemId });
    }
  }
}

function showWebNotification(
  title: string,
  body: string,
  opts: { silent?: boolean; itemType?: string; itemId?: string },
) {
  const n = new Notification(title, {
    body,
    silent: opts.silent,
    tag: opts.itemId ? `${opts.itemType}-${opts.itemId}` : undefined,
  });
  // Web Notification API doesn't support action buttons in most browsers,
  // but we can navigate on click
  if (opts.itemId && opts.itemType) {
    n.onclick = () => {
      window.focus();
      const route = opts.itemType === 'todo' ? `/tasks/${opts.itemId}` : `/events/${opts.itemId}`;
      window.dispatchEvent(new CustomEvent('navigate', { detail: route }));
    };
  }
}

/**
 * Storage abstraction — localStorage on every supported runtime. The async
 * signature is kept so callers stay agnostic about the backing store.
 */
const storage = {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  },

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  },

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};

const pendingSecureOperations = new Map<string, Promise<unknown>>();

/** Run operations on one key in the order they were asked for. */
function inKeyOrder<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingSecureOperations.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const settled = next.catch(() => undefined);
  pendingSecureOperations.set(key, settled);
  void settled.then(() => {
    if (pendingSecureOperations.get(key) === settled) pendingSecureOperations.delete(key);
  });
  return next;
}

/**
 * Secure storage uses the desktop OS credential vault when available; the web
 * build and unavailable OS vaults use platform storage instead.
 *
 * A platform-storage copy is always the newest value: every successful vault
 * write clears it, so it only exists for a legacy session or for a write the
 * vault refused. The vault can refuse a write while still answering reads --
 * on macOS an updated, re-signed app may lose write access to the item the
 * previous build created -- and reading the vault first would then return a
 * refresh token the server already rotated, which it treats as replay and
 * answers by revoking the session. So the local copy wins, and is promoted to
 * the vault whenever the vault accepts it. Operations on one key run in order
 * so an earlier write can never land after a later one.
 */
export const secureStorage = {
  get(key: string): Promise<string | null> {
    return inKeyOrder(key, async () => {
      const vault = platformApi.secureStorage;
      if (!vault) return storage.get(key);

      const local = await storage.get(key);
      if (local !== null) {
        try {
          await vault.set(key, local);
          await storage.remove(key);
        } catch (error) {
          console.warn(
            'OS secure storage refused a credential; keeping the newer local copy.',
            error,
          );
        }
        return local;
      }

      try {
        return await vault.get(key);
      } catch (error) {
        console.warn('OS secure storage is unavailable; using platform storage.', error);
        return null;
      }
    });
  },
  set(key: string, value: string): Promise<void> {
    return inKeyOrder(key, async () => {
      const vault = platformApi.secureStorage;
      if (vault) {
        try {
          await vault.set(key, value);
          await storage.remove(key);
          return;
        } catch (error) {
          console.warn('OS secure storage refused a credential; storing it locally.', error);
        }
      }
      await storage.set(key, value);
    });
  },
  remove(key: string): Promise<void> {
    return inKeyOrder(key, async () => {
      const vault = platformApi.secureStorage;
      if (vault) {
        try {
          await vault.remove(key);
        } catch (error) {
          console.warn('OS secure storage is unavailable while removing a credential.', error);
        }
      }
      await storage.remove(key);
    });
  },
};
