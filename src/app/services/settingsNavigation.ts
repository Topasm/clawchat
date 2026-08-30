export interface SettingsNavigationState {
  settingsReturnTo?: string;
}

export function isSettingsSurfacePath(pathname: string): boolean {
  return (
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/connections' ||
    pathname === '/diagnostics'
  );
}

export function readSettingsReturnTo(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as SettingsNavigationState).settingsReturnTo;
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    isSettingsSurfacePath(value)
  ) {
    return null;
  }
  return value;
}

export function settingsNavigationState(
  pathname: string,
  search = '',
  existingState?: unknown,
): SettingsNavigationState | undefined {
  const existingReturnTo = readSettingsReturnTo(existingState);
  if (existingReturnTo) return { settingsReturnTo: existingReturnTo };
  if (isSettingsSurfacePath(pathname)) return undefined;
  return { settingsReturnTo: `${pathname}${search}` };
}
