export type Platform = 'web' | 'electron' | 'ios' | 'android';

export const IS_ELECTRON = typeof window !== 'undefined' && !!window.electronAPI;

export const IS_CAPACITOR =
  typeof window !== 'undefined' &&
  !!(window as Record<string, unknown>).Capacitor;

export const IS_IOS =
  IS_CAPACITOR &&
  (window as Record<string, unknown> & { Capacitor?: { getPlatform?: () => string } })
    .Capacitor?.getPlatform?.() === 'ios';

export const IS_ANDROID =
  IS_CAPACITOR &&
  (window as Record<string, unknown> & { Capacitor?: { getPlatform?: () => string } })
    .Capacitor?.getPlatform?.() === 'android';

export const IS_MOBILE = IS_IOS || IS_ANDROID;
export const IS_DESKTOP = IS_ELECTRON;
export const IS_WEB = !IS_ELECTRON && !IS_CAPACITOR;

export function detectPlatform(): Platform {
  if (IS_ELECTRON) return 'electron';
  if (IS_IOS) return 'ios';
  if (IS_ANDROID) return 'android';
  return 'web';
}
