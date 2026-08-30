import { describe, expect, it } from 'vitest';
import {
  isSettingsSurfacePath,
  readSettingsReturnTo,
  settingsNavigationState,
} from '../settingsNavigation';

describe('settings navigation', () => {
  it('recognizes every settings surface', () => {
    expect(isSettingsSurfacePath('/settings/app')).toBe(true);
    expect(isSettingsSurfacePath('/settings/workspace')).toBe(true);
    expect(isSettingsSurfacePath('/connections')).toBe(true);
    expect(isSettingsSurfacePath('/diagnostics')).toBe(true);
    expect(isSettingsSurfacePath('/today')).toBe(false);
  });

  it('captures the originating workspace route and preserves it between panes', () => {
    const initial = settingsNavigationState('/projects/project-1', '?view=graph');
    expect(initial).toEqual({ settingsReturnTo: '/projects/project-1?view=graph' });
    expect(settingsNavigationState('/settings/app', '', initial)).toEqual(initial);
    expect(readSettingsReturnTo(initial)).toBe('/projects/project-1?view=graph');
  });

  it('rejects recursive and external return targets', () => {
    expect(readSettingsReturnTo({ settingsReturnTo: '/settings/app' })).toBeNull();
    expect(readSettingsReturnTo({ settingsReturnTo: 'https://example.com' })).toBeNull();
    expect(readSettingsReturnTo({ settingsReturnTo: '//example.com' })).toBeNull();
  });
});
