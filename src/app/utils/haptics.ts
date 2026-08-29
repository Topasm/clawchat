/**
 * Haptic feedback utilities — uses navigator.vibrate() where the browser
 * supports it, and is a no-op everywhere else.
 */

export async function hapticLight(): Promise<void> {
  if ('vibrate' in navigator) {
    navigator.vibrate(10);
  }
}

export async function hapticMedium(): Promise<void> {
  if ('vibrate' in navigator) {
    navigator.vibrate(30);
  }
}

export async function hapticSuccess(): Promise<void> {
  if ('vibrate' in navigator) {
    navigator.vibrate([10, 50, 10]);
  }
}
