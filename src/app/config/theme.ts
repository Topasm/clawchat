// ---------------------------------------------------------------------------
// ClawChat Theme System (ported from mobile)
// ---------------------------------------------------------------------------

export interface ColorPalette {
  background: string;
  surface: string;
  surfaceSecondary: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  disabled: string;

  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;

  success: string;
  warning: string;
  error: string;

  assistantBubble: string;
  userBubble: string;
  streaming: string;
  actionCard: string;

  todayBlue: string;
  inboxYellow: string;
  completedGreen: string;
  overdueRed: string;

  priorityUrgent: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;

  shadow: string;
  deleteBackground: string;
  metaTagBackground: string;
}

export interface TypographyToken {
  fontSize: number;
  fontWeight: string;
  textTransform?: string;
  letterSpacing?: number;
}

export interface Typography {
  h1: TypographyToken;
  h2: TypographyToken;
  h3: TypographyToken;
  body: TypographyToken;
  bodySmall: TypographyToken;
  caption: TypographyToken;
  label: TypographyToken;
}

export interface Spacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export interface BorderRadius {
  sm: number;
  md: number;
  lg: number;
  full: number;
}

export interface Theme {
  colors: ColorPalette;
  typography: Typography;
  spacing: Spacing;
  borderRadius: BorderRadius;
}

// ---- Light palette --------------------------------------------------------

export const lightColors: ColorPalette = {
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceSecondary: '#F2F2F7',
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  textTertiary: '#C7C7CC',
  border: '#E5E5EA',
  disabled: '#BDBDBD',

  primary: '#2196F3',
  primaryLight: '#64B5F6',
  primaryDark: '#1976D2',
  secondary: '#26A69A',

  success: '#4CAF50',
  warning: '#FF9800',
  error: '#EF5350',

  assistantBubble: '#F0F4F8',
  userBubble: '#2196F3',
  streaming: '#26A69A',
  actionCard: '#FFF8E1',

  todayBlue: '#3478F6',
  inboxYellow: '#FFCC00',
  completedGreen: '#34C759',
  overdueRed: '#FF3B30',

  priorityUrgent: '#FF3B30',
  priorityHigh: '#FF9500',
  priorityMedium: '#FFCC00',
  priorityLow: '#8E8E93',

  shadow: '#000000',
  deleteBackground: '#FFF0F0',
  metaTagBackground: 'rgba(0,0,0,0.05)',
};

// ---- Dark palette ---------------------------------------------------------

export const darkColors: ColorPalette = {
  background: '#000000',
  surface: '#1C1C1E',
  surfaceSecondary: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',
  border: '#38383A',
  disabled: '#48484A',

  primary: '#0A84FF',
  primaryLight: '#409CFF',
  primaryDark: '#0064D2',
  secondary: '#64D2A6',

  success: '#30D158',
  warning: '#FF9F0A',
  error: '#FF453A',

  assistantBubble: '#2C2C2E',
  userBubble: '#0A84FF',
  streaming: '#64D2A6',
  actionCard: '#2C2C2E',

  todayBlue: '#0A84FF',
  inboxYellow: '#FFD60A',
  completedGreen: '#30D158',
  overdueRed: '#FF453A',

  priorityUrgent: '#FF453A',
  priorityHigh: '#FF9F0A',
  priorityMedium: '#FFD60A',
  priorityLow: '#8E8E93',

  shadow: '#000000',
  deleteBackground: '#3A2020',
  metaTagBackground: 'rgba(255,255,255,0.08)',
};

// ---- Shared tokens --------------------------------------------------------

export const typography: Typography = {
  h1: { fontSize: 24, fontWeight: '700' },
  h2: { fontSize: 20, fontWeight: '600' },
  h3: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  bodySmall: { fontSize: 14, fontWeight: '400' },
  caption: { fontSize: 12, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
};

export const spacing: Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const borderRadius: BorderRadius = {
  sm: 4,
  md: 8,
  lg: 16,
  full: 9999,
};

// ---- Composed theme objects -----------------------------------------------

export const lightTheme: Theme = {
  colors: lightColors,
  typography,
  spacing,
  borderRadius,
};

export const darkTheme: Theme = {
  colors: darkColors,
  typography,
  spacing,
  borderRadius,
};

export const themes = { light: lightTheme, dark: darkTheme } as const;
