import { createContext, useContext } from 'react';
import { themes } from './theme';

/**
 * ThemeContext shape:
 *  - colors     : current color palette object (lightColors or darkColors)
 *  - isDark     : boolean - true when effective theme is dark
 *  - mode       : 'light' | 'dark' | 'system'
 *  - setMode    : (mode: 'light' | 'dark' | 'system') => void
 *  - typography : shared typography tokens
 *  - spacing    : shared spacing tokens
 *  - borderRadius : shared border radius tokens
 */
const ThemeContext = createContext({
  ...themes.light,
  colors: themes.light.colors,
  isDark: false,
  mode: 'system',
  setMode: () => {},
});

/**
 * Hook to access the current theme from any component.
 *
 * Usage:
 *   const { colors, isDark, mode, setMode, typography, spacing, borderRadius } = useTheme();
 */
export function useTheme() {
  return useContext(ThemeContext);
}

export default ThemeContext;
