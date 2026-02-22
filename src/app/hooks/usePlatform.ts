import { useMemo } from 'react';
import {
  detectPlatform,
  IS_MOBILE,
  IS_DESKTOP,
  IS_WEB,
  IS_CAPACITOR,
  IS_ELECTRON,
  type Platform,
} from '../types/platform';

interface PlatformInfo {
  platform: Platform;
  isMobile: boolean;
  isDesktop: boolean;
  isWeb: boolean;
  isCapacitor: boolean;
  isElectron: boolean;
}

export default function usePlatform(): PlatformInfo {
  return useMemo(
    () => ({
      platform: detectPlatform(),
      isMobile: IS_MOBILE,
      isDesktop: IS_DESKTOP,
      isWeb: IS_WEB,
      isCapacitor: IS_CAPACITOR,
      isElectron: IS_ELECTRON,
    }),
    [],
  );
}
