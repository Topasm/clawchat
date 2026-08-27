import { useState, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { ThemeContext, type ThemeMode } from './ThemeContext';
import { lightColors, darkColors } from './theme';

const THEME_STORAGE_KEY = 'clawchat-theme-mode';

function getSystemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage can be unavailable in private or restricted WebViews.
  }
  return 'system';
}

function applyDocumentTheme(isDark: boolean) {
  const theme = isDark ? 'dark' : 'light';
  document.documentElement.dataset.ccTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', isDark ? '#111316' : '#F7F8FA');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);

  const [systemDark, setSystemDark] = useState(getSystemDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }

    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch {
      // Keep the in-memory preference when persistence is unavailable.
    }
  };

  const isDark = mode === 'system' ? systemDark : mode === 'dark';

  useLayoutEffect(() => {
    applyDocumentTheme(isDark);
  }, [isDark]);

  const value = useMemo(
    () => ({
      colors: isDark ? darkColors : lightColors,
      isDark,
      mode,
      setMode,
    }),
    [isDark, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
