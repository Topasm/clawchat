import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface StreakData {
  lastCompletedDate: string;
  currentStreak: number;
}

interface SettingsState {
  // Chat
  fontSize: number;
  messageBubbleStyle: string;
  sendOnEnter: boolean;
  showTimestamps: boolean;
  showAvatars: boolean;

  // LLM
  llmModel: string;
  temperature: number;
  systemPrompt: string;
  maxTokens: number;
  streamResponses: boolean;

  // Appearance
  theme: string;
  compactMode: boolean;
  sidebarSize: number;
  chatPanelSize: number;

  // Notifications
  notificationsEnabled: boolean;
  reminderSound: boolean;

  // Privacy
  saveHistory: boolean;
  analyticsEnabled: boolean;

  // Streak
  streak: StreakData;

  // Setters
  setFontSize: (v: number) => void;
  setMessageBubbleStyle: (v: string) => void;
  setSendOnEnter: (v: boolean) => void;
  setShowTimestamps: (v: boolean) => void;
  setShowAvatars: (v: boolean) => void;
  setLlmModel: (v: string) => void;
  setTemperature: (v: number) => void;
  setSystemPrompt: (v: string) => void;
  setMaxTokens: (v: number) => void;
  setStreamResponses: (v: boolean) => void;
  setTheme: (v: string) => void;
  setCompactMode: (v: boolean) => void;
  setSidebarSize: (v: number) => void;
  setChatPanelSize: (v: number) => void;
  setNotificationsEnabled: (v: boolean) => void;
  setReminderSound: (v: boolean) => void;
  setSaveHistory: (v: boolean) => void;
  setAnalyticsEnabled: (v: boolean) => void;
  setStreak: (v: StreakData) => void;

  // Actions
  resetToDefaults: () => void;
  exportSettings: () => string;
  importSettings: (json: string) => { success: boolean; count?: number; error?: string };
}

const DEFAULT_SETTINGS = {
  fontSize: 16,
  messageBubbleStyle: 'modern',
  sendOnEnter: true, // desktop convention: true (mobile was false)
  showTimestamps: true,
  showAvatars: true,

  llmModel: 'openclaw-default',
  temperature: 0.7,
  systemPrompt: 'You are a helpful assistant.',
  maxTokens: 2048,
  streamResponses: true,

  theme: 'system',
  compactMode: false,
  sidebarSize: 18,
  chatPanelSize: 30,

  notificationsEnabled: true,
  reminderSound: true,

  saveHistory: true,
  analyticsEnabled: false,

  streak: { lastCompletedDate: '', currentStreak: 0 },
} as const;

type DefaultKeys = keyof typeof DEFAULT_SETTINGS;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setFontSize: (fontSize) => set({ fontSize }),
      setMessageBubbleStyle: (messageBubbleStyle) => set({ messageBubbleStyle }),
      setSendOnEnter: (sendOnEnter) => set({ sendOnEnter }),
      setShowTimestamps: (showTimestamps) => set({ showTimestamps }),
      setShowAvatars: (showAvatars) => set({ showAvatars }),

      setLlmModel: (llmModel) => set({ llmModel }),
      setTemperature: (temperature) => set({ temperature }),
      setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
      setMaxTokens: (maxTokens) => set({ maxTokens }),
      setStreamResponses: (streamResponses) => set({ streamResponses }),

      setTheme: (theme) => set({ theme }),
      setCompactMode: (compactMode) => set({ compactMode }),
      setSidebarSize: (sidebarSize) => set({ sidebarSize }),
      setChatPanelSize: (chatPanelSize) => set({ chatPanelSize }),

      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setReminderSound: (reminderSound) => set({ reminderSound }),

      setSaveHistory: (saveHistory) => set({ saveHistory }),
      setAnalyticsEnabled: (analyticsEnabled) => set({ analyticsEnabled }),
      setStreak: (streak) => set({ streak }),

      resetToDefaults: () => set({ ...DEFAULT_SETTINGS }),

      exportSettings: () => {
        const state = get();
        const exported: Record<string, unknown> = {};
        for (const key of Object.keys(DEFAULT_SETTINGS) as DefaultKeys[]) {
          exported[key] = state[key];
        }
        return JSON.stringify(exported, null, 2);
      },

      importSettings: (json: string) => {
        try {
          const parsed = JSON.parse(json);
          const validSettings: Record<string, unknown> = {};
          for (const key of Object.keys(DEFAULT_SETTINGS) as DefaultKeys[]) {
            if (key in parsed && typeof parsed[key] === typeof DEFAULT_SETTINGS[key]) {
              validSettings[key] = parsed[key];
            }
          }
          set(validSettings as Partial<SettingsState>);
          return { success: true, count: Object.keys(validSettings).length };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export { DEFAULT_SETTINGS };
