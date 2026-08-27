import { platformApi } from '../platform';

export type Platform = 'web' | 'tauri' | 'ios' | 'android';

type CapacitorWindow = Window & {
  Capacitor?: {
    getPlatform?: () => string;
  };
};

const runtimeWindow =
  typeof window !== 'undefined' ? (window as unknown as CapacitorWindow) : undefined;

export const IS_TAURI = platformApi.runtime.kind === 'tauri';

export const IS_CAPACITOR = !!runtimeWindow?.Capacitor;

export const IS_IOS = IS_CAPACITOR && runtimeWindow?.Capacitor?.getPlatform?.() === 'ios';

export const IS_ANDROID = IS_CAPACITOR && runtimeWindow?.Capacitor?.getPlatform?.() === 'android';

export const IS_MOBILE = IS_IOS || IS_ANDROID;
export const IS_DESKTOP = platformApi.runtime.isDesktop;
export const IS_WEB = !IS_DESKTOP && !IS_CAPACITOR;

export function detectPlatform(): Platform {
  if (IS_TAURI) return 'tauri';
  if (IS_IOS) return 'ios';
  if (IS_ANDROID) return 'android';
  return 'web';
}
