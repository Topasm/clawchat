import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * jsdom ships no `matchMedia`, so each test installs a controllable one and the
 * module under test is re-imported afterwards — `IS_DESKTOP` is read at module
 * load, and the hook reads the query lazily.
 */
type Listener = () => void;

function installMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches,
    media: '',
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    setMatches(next: boolean) {
      query.matches = next;
      listeners.forEach((fn) => fn());
    },
    listenerCount: () => listeners.size,
  };
}

async function loadHook(isDesktop: boolean) {
  vi.resetModules();
  vi.doMock('../../platform', () => ({
    platformApi: { runtime: { kind: isDesktop ? 'tauri' : 'web', isDesktop } },
  }));
  return (await import('../usePlatform')).default;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../../platform');
  vi.resetModules();
});

describe('usePlatform', () => {
  describe('on the web', () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
    });

    it('reports mobile on a narrow viewport', async () => {
      installMatchMedia(true);
      const usePlatform = await loadHook(false);

      expect(renderHook(() => usePlatform()).result.current.isMobile).toBe(true);
    });

    it('reports desktop shell on a wide viewport', async () => {
      installMatchMedia(false);
      const usePlatform = await loadHook(false);

      expect(renderHook(() => usePlatform()).result.current.isMobile).toBe(false);
    });

    // The point of the change: a rotation or resize must not leave the wrong
    // shell mounted, which a module-level constant could never handle.
    it('follows the viewport while mounted', async () => {
      const media = installMatchMedia(false);
      const usePlatform = await loadHook(false);
      const { result } = renderHook(() => usePlatform());

      expect(result.current.isMobile).toBe(false);
      act(() => media.setMatches(true));
      expect(result.current.isMobile).toBe(true);
      act(() => media.setMatches(false));
      expect(result.current.isMobile).toBe(false);
    });

    it('unsubscribes on unmount', async () => {
      const media = installMatchMedia(true);
      const usePlatform = await loadHook(false);
      const { unmount } = renderHook(() => usePlatform());

      expect(media.listenerCount()).toBe(1);
      unmount();
      expect(media.listenerCount()).toBe(0);
    });
  });

  // A narrow Tauri window is still a desktop app; this is how it behaved before.
  it('never reports mobile on desktop, however narrow', async () => {
    installMatchMedia(true);
    const usePlatform = await loadHook(true);

    const { result } = renderHook(() => usePlatform());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isDesktop).toBe(true);
  });

  it('falls back to the desktop shell where matchMedia is unavailable', async () => {
    vi.unstubAllGlobals();
    const usePlatform = await loadHook(false);

    expect(renderHook(() => usePlatform()).result.current.isMobile).toBe(false);
  });
});
