import { describe, expect, it } from 'vitest';
import { isWorkspaceSessionReady, resolveNativeSettingsRoute } from '../nativeRoutePolicy';

describe('native route policy', () => {
  it('opens workspace settings only for a healthy usable session', () => {
    expect(
      isWorkspaceSessionReady({
        token: 'token',
        healthOK: true,
        hostPhase: 'connected',
      }),
    ).toBe(true);
    expect(
      resolveNativeSettingsRoute({
        token: 'token',
        healthOK: true,
        hostPhase: 'idle',
      }),
    ).toBe('/settings/workspace');
  });

  it.each([
    { token: null, healthOK: true, hostPhase: 'idle' as const },
    { token: 'token', healthOK: false, hostPhase: 'idle' as const },
    { token: 'token', healthOK: true, hostPhase: 'blocked' as const },
  ])('routes an unavailable workspace to recovery: %o', (context) => {
    expect(resolveNativeSettingsRoute(context)).toBe('/settings/app');
  });
});
