import { platformApi } from '../platform';

export type Platform = 'web' | 'tauri';

export const IS_TAURI = platformApi.runtime.kind === 'tauri';

export const IS_DESKTOP = platformApi.runtime.isDesktop;
export const IS_WEB = !IS_DESKTOP;

/**
 * The compact mobile shell (bottom navigation, swipe tabs, mobile status bar)
 * follows the viewport, not the platform.
 *
 * It used to be gated on ``IS_IOS || IS_ANDROID``, both of which required the
 * Capacitor wrapper — so a phone *browser* never got it, and once the wrapper
 * was removed nothing did. The breakpoint matches the dominant one in
 * ``src/styles`` so the JS and CSS shells switch together.
 *
 * Desktop is excluded deliberately: a narrow Tauri window is still a desktop
 * app, and that is how it behaved before.
 */
export const MOBILE_VIEWPORT_QUERY = '(max-width: 768px)';

function mobileViewport(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(MOBILE_VIEWPORT_QUERY);
}

export function isMobileViewport(): boolean {
  return !IS_DESKTOP && (mobileViewport()?.matches ?? false);
}

/** Subscribe to viewport changes, for ``useSyncExternalStore``. */
export function subscribeToMobileViewport(onChange: () => void): () => void {
  const query = mobileViewport();
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function detectPlatform(): Platform {
  return IS_TAURI ? 'tauri' : 'web';
}
