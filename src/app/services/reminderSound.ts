import { IS_CAPACITOR, IS_ELECTRON } from '../types/platform';

/**
 * Plays a short reminder chime. Used when reminderSound is enabled.
 * On Capacitor/Electron, the OS handles notification sound via the `silent` flag.
 * On web, we play an audio cue since the Notification API `silent` property
 * isn't reliably supported across browsers.
 */
export function playReminderSound(): void {
  // Capacitor and Electron handle sound natively via notification options
  if (IS_CAPACITOR || IS_ELECTRON) return;

  try {
    // Use Web Audio API for a short chime — no audio file needed
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587, ctx.currentTime);       // D5
    osc.frequency.setValueAtTime(784, ctx.currentTime + 0.12); // G5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.24); // A5

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);

    osc.onended = () => ctx.close();
  } catch {
    // AudioContext may be blocked until user interaction — best-effort
  }
}
