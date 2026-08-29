import { platformApi } from '../platform';

export type Platform = 'web' | 'tauri';

export const IS_TAURI = platformApi.runtime.kind === 'tauri';

export const IS_DESKTOP = platformApi.runtime.isDesktop;
export const IS_WEB = !IS_DESKTOP;

/**
 * The compact mobile shell (bottom navigation, swipe tabs, mobile status bar)
 * still ships in the renderer, but no supported runtime reports as mobile now
 * that the Capacitor/iOS wrapper is gone — web and Tauri both render the
 * desktop shell. Kept as an explicit flag so the shell can be re-enabled from a
 * real signal (viewport, or a future native wrapper) in one place.
 */
export const IS_MOBILE: boolean = false;

export function detectPlatform(): Platform {
  return IS_TAURI ? 'tauri' : 'web';
}
