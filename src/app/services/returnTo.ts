import type { NavigateFunction } from 'react-router-dom';

/** Router state carried by a screen that was opened from another, so its ← can return there. */
export interface ReturnToState {
  returnTo?: string;
}

/** The in-app path a screen was opened from, or null when the state carries none. */
export function readReturnTo(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as ReturnToState).returnTo;
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

/** State to pass with `navigate` so the opened screen knows where it came from. */
export function returnToState(pathname: string, search = ''): ReturnToState {
  return { returnTo: `${pathname}${search}` };
}

/**
 * Where ← goes: the remembered origin first, then one step back in history
 * when there is one, then the fallback for a deep link that opened cold.
 */
export function goBack(navigate: NavigateFunction, state: unknown, fallback: string): void {
  const returnTo = readReturnTo(state);
  if (returnTo) {
    navigate(returnTo);
    return;
  }
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  if (typeof idx === 'number' && idx > 0) {
    navigate(-1);
    return;
  }
  navigate(fallback);
}
