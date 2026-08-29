import { useMemo, useSyncExternalStore } from 'react';
import {
  detectPlatform,
  IS_DESKTOP,
  IS_TAURI,
  IS_WEB,
  isMobileViewport,
  subscribeToMobileViewport,
  type Platform,
} from '../types/platform';

interface PlatformInfo {
  platform: Platform;
  isMobile: boolean;
  isDesktop: boolean;
  isWeb: boolean;
  isTauri: boolean;
}

export default function usePlatform(): PlatformInfo {
  // Live, because the viewport can change under a running app — a rotated
  // phone or a resized window must not leave the wrong shell mounted.
  const isMobile = useSyncExternalStore(subscribeToMobileViewport, isMobileViewport, () => false);

  return useMemo(
    () => ({
      platform: detectPlatform(),
      isMobile,
      isDesktop: IS_DESKTOP,
      isWeb: IS_WEB,
      isTauri: IS_TAURI,
    }),
    [isMobile],
  );
}
