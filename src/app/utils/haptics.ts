/**
 * Haptic feedback utilities — uses @capacitor/haptics on mobile for native
 * VibrationEffect patterns, falls back to navigator.vibrate() on web.
 */

import { IS_CAPACITOR } from '../types/platform';

export async function hapticLight(): Promise<void> {
  if (IS_CAPACITOR) {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } else if ('vibrate' in navigator) {
    navigator.vibrate(10);
  }
}

export async function hapticMedium(): Promise<void> {
  if (IS_CAPACITOR) {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
  } else if ('vibrate' in navigator) {
    navigator.vibrate(30);
  }
}

export async function hapticSuccess(): Promise<void> {
  if (IS_CAPACITOR) {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Success });
  } else if ('vibrate' in navigator) {
    navigator.vibrate([10, 50, 10]);
  }
}
