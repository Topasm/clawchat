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

  shadow: string;
  deleteBackground: string;
  metaTagBackground: string;
}

// ---- Light palette --------------------------------------------------------

export const lightColors: ColorPalette = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceSecondary: '#F0F2F5',
  text: '#181A1D',
  textSecondary: '#626872',
  textTertiary: '#969DA7',
  border: '#E1E4E8',
  disabled: '#AEB4BC',

  primary: '#2563EB',
  primaryLight: '#DBEAFE',
  primaryDark: '#1D4ED8',
  secondary: '#0F9F8F',

  success: '#4CAF50',
  warning: '#FF9800',
  error: '#EF5350',

  assistantBubble: '#F0F2F5',
  userBubble: '#2563EB',
  streaming: '#0F9F8F',
  actionCard: '#FFFBEB',

  todayBlue: '#3478F6',
  inboxYellow: '#FFCC00',
  completedGreen: '#34C759',
  overdueRed: '#FF3B30',

  shadow: '#000000',
  deleteBackground: '#FFF0F0',
  metaTagBackground: 'rgba(0,0,0,0.04)',
};

// ---- Dark palette ---------------------------------------------------------

export const darkColors: ColorPalette = {
  background: '#111316',
  surface: '#181B1F',
  surfaceSecondary: '#22262B',
  text: '#F3F4F6',
  textSecondary: '#A0A6AF',
  textTertiary: '#6F7680',
  border: '#30353B',
  disabled: '#5B626C',

  primary: '#60A5FA',
  primaryLight: '#1E3A5F',
  primaryDark: '#3B82F6',
  secondary: '#5EEAD4',

  success: '#30D158',
  warning: '#FF9F0A',
  error: '#FF453A',

  assistantBubble: '#22262B',
  userBubble: '#2563EB',
  streaming: '#64D2A6',
  actionCard: '#22262B',

  todayBlue: '#0A84FF',
  inboxYellow: '#FFD60A',
  completedGreen: '#30D158',
  overdueRed: '#FF453A',

  shadow: '#000000',
  deleteBackground: '#3A2020',
  metaTagBackground: 'rgba(255,255,255,0.08)',
};
