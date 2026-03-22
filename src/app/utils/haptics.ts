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

export async function hapticHeavy(): Promise<void> {
  if (IS_CAPACITOR) {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Heavy });
  } else if ('vibrate' in navigator) {
    navigator.vibrate(50);
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

export async function hapticError(): Promise<void> {
  if (IS_CAPACITOR) {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Error });
  } else if ('vibrate' in navigator) {
    navigator.vibrate([30, 50, 30]);
  }
}

export async function hapticSelection(): Promise<void> {
  if (IS_CAPACITOR) {
    const { Haptics } = await import('@capacitor/haptics');
    await Haptics.selectionStart();
    await Haptics.selectionEnd();
  } else if ('vibrate' in navigator) {
    navigator.vibrate(5);
  }
}
