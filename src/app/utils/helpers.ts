import { useAuthStore } from '../stores/useAuthStore';

export function isDemoMode(): boolean {
  return !useAuthStore.getState().serverUrl;
}

export function isTextInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}
