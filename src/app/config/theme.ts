// ---------------------------------------------------------------------------
// ClawChat Theme System
//
// Most of the screen is grey; colour is kept for meaning. Dark is grey, not
// black: panels sit a step darker than the page and cards a step lighter, so
// surfaces part by brightness instead of lines.
// ---------------------------------------------------------------------------

export interface ColorPalette {
  /** The page. */
  background: string;
  /** The sidebar and side panels: a step away from the page, no border. */
  sidebar: string;
  /** Cards, flow boxes and dialogs. */
  surface: string;
  /** Raised areas: the selected row, search field, tags, finished flow boxes. */
  surfaceSecondary: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  /** Lines of the flow graph. */
  connector: string;
  disabled: string;

  /** Filled blue: done checks, the + button, progress rings, the running box. */
  primary: string;
  primaryLight: string;
  primaryDark: string;
  /** Blue as text: links and section titles. */
  link: string;
  /** The task list icon. */
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
  background: '#FFFFFF',
  sidebar: '#F4F4F6',
  surface: '#FFFFFF',
  surfaceSecondary: '#ECECEF',
  text: '#1D1D1F',
  textSecondary: '#48484A',
  textTertiary: '#6E6E73',
  border: '#E6E6EA',
  connector: '#AEAEB2',
  disabled: '#AEAEB2',

  primary: '#3A82F7',
  primaryLight: '#E2EDFE',
  primaryDark: '#2F6FE0',
  link: '#2F6FE0',
  secondary: '#1F8F8C',

  success: '#2F9A5F',
  warning: '#A86F00',
  error: '#D23B40',

  assistantBubble: '#F4F4F6',
  userBubble: '#3A82F7',
  streaming: '#2F9A5F',
  actionCard: '#FFFFFF',

  todayBlue: '#F2B90C',
  inboxYellow: '#F2B90C',
  completedGreen: '#2F9A5F',
  overdueRed: '#D23B40',

  shadow: '#000000',
  deleteBackground: '#FBEDEE',
  metaTagBackground: 'rgba(0,0,0,0.04)',
};

// ---- Dark palette ---------------------------------------------------------

export const darkColors: ColorPalette = {
  background: '#1E1E20',
  sidebar: '#19191B',
  surface: '#28282B',
  surfaceSecondary: '#2C2C2F',
  text: '#F2F2F3',
  textSecondary: '#C7C7CC',
  textTertiary: '#9A9A9F',
  border: '#38383B',
  connector: '#6E6E73',
  disabled: '#6E6E73',

  primary: '#4A8DFA',
  primaryLight: '#273B5E',
  primaryDark: '#6EA6FF',
  link: '#6EA6FF',
  secondary: '#4CC2BE',

  success: '#5CC98A',
  warning: '#F5C83A',
  error: '#F0676B',

  assistantBubble: '#28282B',
  userBubble: '#4A8DFA',
  streaming: '#5CC98A',
  actionCard: '#28282B',

  todayBlue: '#F5C83A',
  inboxYellow: '#F5C83A',
  completedGreen: '#5CC98A',
  overdueRed: '#F0676B',

  shadow: '#000000',
  deleteBackground: '#3A2626',
  metaTagBackground: 'rgba(255,255,255,0.08)',
};
