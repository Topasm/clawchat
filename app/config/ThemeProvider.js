import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useColorScheme, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ThemeContext from './ThemeContext';
import { themes } from './theme';

const THEME_STORAGE_KEY = 'theme_mode';

/**
 * ThemeProvider
 *
 * Wraps the application and provides the current theme via ThemeContext.
 *
 * Behaviour:
 *  - Reads persisted preference from AsyncStorage on mount.
 *  - When mode is 'system', follows the device colour scheme via useColorScheme().
 *  - Exposes setMode() so any consumer (e.g. Settings screen) can change the
 *    preference at runtime.
 */
export default function ThemeProvider({ children }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState('system'); // 'light' | 'dark' | 'system'
  const [loaded, setLoaded] = useState(false);

  // --- Load persisted preference on mount ---
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      } catch {
        // Ignore read errors; fall back to 'system'.
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // --- Persist on change ---
  const setMode = useCallback(async (newMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch {
      // Ignore write errors.
    }
  }, []);

  // --- Resolve effective theme ---
  const isDark = useMemo(() => {
    if (mode === 'system') {
      return systemScheme === 'dark';
    }
    return mode === 'dark';
  }, [mode, systemScheme]);

  const currentTheme = isDark ? themes.dark : themes.light;

  const value = useMemo(
    () => ({
      ...currentTheme,
      colors: currentTheme.colors,
      isDark,
      mode,
      setMode,
    }),
    [currentTheme, isDark, mode, setMode]
  );

  // Don't render children until we've read the stored preference so we avoid
  // a flash of the wrong theme.
  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={currentTheme.colors.background}
      />
      {children}
    </ThemeContext.Provider>
  );
}
