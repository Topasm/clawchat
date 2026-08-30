import { describe, expect, it, vi } from 'vitest';
import { webPlatformApi } from '../webPlatformApi';

describe('webPlatformApi', () => {
  it('exposes a non-desktop runtime with inert event subscriptions', () => {
    const listener = vi.fn();
    const unsubscribe = webPlatformApi.events.on('navigate', listener);

    expect(webPlatformApi.runtime.kind).toBe('web');
    expect(webPlatformApi.runtime.isDesktop).toBe(false);
    expect(webPlatformApi.runtime.appVersion).toBe(__APP_VERSION__);
    expect(unsubscribe).toBeTypeOf('function');
    expect(listener).not.toHaveBeenCalled();
  });

  it('fails explicitly if desktop server functions are called from the web', async () => {
    await expect(webPlatformApi.server.getStatus()).rejects.toThrow(
      'Native server is unavailable in the web runtime',
    );
  });
});
