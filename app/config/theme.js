// ---------------------------------------------------------------------------
// ClawChat Theme System
// ---------------------------------------------------------------------------
// Provides light and dark color palettes, shared typography, spacing, and
// border-radius tokens.  The original `theme` export is preserved for backward
// compatibility (it always refers to the light palette).
// ---------------------------------------------------------------------------

// ---- Light palette --------------------------------------------------------

const lightColors = {
  // Core surfaces
  background: '#F2F2F7',        // Main background
  surface: '#FFFFFF',           // Cards, cells
  surfaceSecondary: '#F2F2F7',  // Secondary surfaces (e.g. icon wrappers)
  text: '#1C1C1E',             // Primary text
  textSecondary: '#8E8E93',    // Secondary text
  textTertiary: '#C7C7CC',     // Placeholder / tertiary text
  border: '#E5E5EA',           // Borders, separators
  disabled: '#BDBDBD',         // Disabled elements

  // Brand / primary
  primary: '#2196F3',
  primaryLight: '#64B5F6',
  primaryDark: '#1976D2',
  secondary: '#26A69A',

  // Semantic
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#EF5350',

  // AI-specific
  assistantBubble: '#F0F4F8',
  userBubble: '#2196F3',
  streaming: '#26A69A',
  actionCard: '#FFF8E1',

  // Module-specific (Things 3 palette)
  todayBlue: '#3478F6',
  inboxYellow: '#FFCC00',
  completedGreen: '#34C759',
  overdueRed: '#FF3B30',

  // Priority
  priorityUrgent: '#FF3B30',
  priorityHigh: '#FF9500',
  priorityMedium: '#FFCC00',
  priorityLow: '#8E8E93',

  // Misc
  shadow: '#000000',
  deleteBackground: '#FFF0F0',
  metaTagBackground: 'rgba(0,0,0,0.05)',
};

// ---- Dark palette ---------------------------------------------------------

const darkColors = {
  // Core surfaces (pure black for OLED)
  background: '#000000',
  surface: '#1C1C1E',
  surfaceSecondary: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',
  border: '#38383A',
  disabled: '#48484A',

  // Brand / primary (brighter for dark backgrounds)
  primary: '#0A84FF',
  primaryLight: '#409CFF',
  primaryDark: '#0064D2',
  secondary: '#64D2A6',

  // Semantic (iOS-style dark mode colors)
  success: '#30D158',
  warning: '#FF9F0A',
  error: '#FF453A',

  // AI-specific
  assistantBubble: '#2C2C2E',
  userBubble: '#0A84FF',
  streaming: '#64D2A6',
  actionCard: '#2C2C2E',

  // Module-specific
  todayBlue: '#0A84FF',
  inboxYellow: '#FFD60A',
  completedGreen: '#30D158',
  overdueRed: '#FF453A',

  // Priority
  priorityUrgent: '#FF453A',
  priorityHigh: '#FF9F0A',
  priorityMedium: '#FFD60A',
  priorityLow: '#8E8E93',

  // Misc
  shadow: '#000000',
  deleteBackground: '#3A2020',
  metaTagBackground: 'rgba(255,255,255,0.08)',
};

// ---- Shared tokens --------------------------------------------------------

const typography = {
  h1: { fontSize: 24, fontWeight: '700' },
  h2: { fontSize: 20, fontWeight: '600' },
  h3: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  bodySmall: { fontSize: 14, fontWeight: '400' },
  caption: { fontSize: 12, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

const borderRadius = {
  sm: 4,
  md: 8,
  lg: 16,
  full: 9999,
};

// ---- Composed theme objects -----------------------------------------------

const lightTheme = {
  colors: lightColors,
  typography,
  spacing,
  borderRadius,
};

const darkTheme = {
  colors: darkColors,
  typography,
  spacing,
  borderRadius,
};

// ---- Exports --------------------------------------------------------------

/** Both themes keyed by mode. */
export const themes = { light: lightTheme, dark: darkTheme };

/**
 * Backward-compatible default export.  Code that does
 *   `import { theme } from '../config/theme'`
 * will continue to work and receive the light palette.
 */
export const theme = lightTheme;

export { lightColors, darkColors, typography, spacing, borderRadius };
