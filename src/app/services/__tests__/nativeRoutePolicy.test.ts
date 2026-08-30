import { describe, expect, it } from 'vitest';
import { isWorkspaceSessionReady, resolveNativeSettingsRoute } from '../nativeRoutePolicy';

describe('native route policy', () => {
  it('detects a healthy usable workspace session', () => {
    expect(
      isWorkspaceSessionReady({
        token: 'token',
        healthOK: true,
        hostPhase: 'connected',
      }),
    ).toBe(true);
    expect(resolveNativeSettingsRoute({ token: 'token', healthOK: true, hostPhase: 'idle' })).toBe(
      '/settings/app',
    );
  });

  it.each([
    { token: null, healthOK: true, hostPhase: 'idle' as const },
    { token: 'token', healthOK: false, hostPhase: 'idle' as const },
    { token: 'token', healthOK: true, hostPhase: 'blocked' as const },
  ])('keeps native Settings on the stable application pane: %o', (context) => {
    expect(resolveNativeSettingsRoute(context)).toBe('/settings/app');
  });
});
