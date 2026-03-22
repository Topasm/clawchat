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

// ---- Light palette --------------------------------------------------------

export const lightColors: ColorPalette = {
  background: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceSecondary: '#EEEEEE',
  text: '#1C1C1E',
  textSecondary: '#757575',
  textTertiary: '#BDBDBD',
  border: '#E0E0E0',
  disabled: '#BDBDBD',

  primary: '#1976D2',
  primaryLight: '#BBDEFB',
  primaryDark: '#1565C0',
  secondary: '#26A69A',

  success: '#4CAF50',
  warning: '#FF9800',
  error: '#EF5350',

  assistantBubble: '#F5F5F5',
  userBubble: '#1976D2',
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
  metaTagBackground: 'rgba(0,0,0,0.04)',
};

// ---- Dark palette ---------------------------------------------------------

export const darkColors: ColorPalette = {
  background: '#121212',
  surface: '#1E1E1E',
  surfaceSecondary: '#2A2A2A',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',
  border: '#333333',
  disabled: '#48484A',

  primary: '#42A5F5',
  primaryLight: '#409CFF',
  primaryDark: '#0064D2',
  secondary: '#64D2A6',

  success: '#30D158',
  warning: '#FF9F0A',
  error: '#FF453A',

  assistantBubble: '#2A2A2A',
  userBubble: '#1976D2',
  streaming: '#64D2A6',
  actionCard: '#2A2A2A',

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
