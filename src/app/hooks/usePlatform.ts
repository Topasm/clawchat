import { useMemo, useSyncExternalStore } from 'react';
import {
  DESKTOP_OS,
  detectPlatform,
  IS_DESKTOP,
  IS_LINUX,
  IS_MAC,
  IS_TAURI,
  IS_WEB,
  IS_WINDOWS,
  isMobileViewport,
  subscribeToMobileViewport,
  type Platform,
} from '../types/platform';
import type { DesktopOS } from '../platform';

interface PlatformInfo {
  platform: Platform;
  isMobile: boolean;
  isDesktop: boolean;
  isWeb: boolean;
  isTauri: boolean;
  desktopOS: DesktopOS | null;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
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
      desktopOS: DESKTOP_OS,
      isMac: IS_MAC,
      isWindows: IS_WINDOWS,
      isLinux: IS_LINUX,
    }),
    [isMobile],
  );
}
