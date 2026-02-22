/** Thin wrapper around navigator.vibrate() for haptic feedback on mobile. */

export function hapticLight(): void {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

export function hapticMedium(): void {
  if ('vibrate' in navigator) navigator.vibrate(30);
}
