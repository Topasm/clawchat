import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_SETTINGS = {
  // Chat Settings
  fontSize: 16,
  messageBubbleStyle: 'modern',
  sendOnEnter: false,
  showTimestamps: true,
  showAvatars: true,

  // LLM Settings
  llmModel: 'openclaw-default',
  temperature: 0.7,
  systemPrompt: 'You are a helpful assistant.',
  maxTokens: 2048,
  streamResponses: true,

  // Appearance
  theme: 'system',
  compactMode: false,

  // Notifications
  notificationsEnabled: true,
  reminderSound: true,

  // Privacy & Data
  saveHistory: true,
  analyticsEnabled: false,
};

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      // Individual setters
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

      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setReminderSound: (reminderSound) => set({ reminderSound }),

      setSaveHistory: (saveHistory) => set({ saveHistory }),
      setAnalyticsEnabled: (analyticsEnabled) => set({ analyticsEnabled }),

      // Actions
      resetToDefaults: () => set({ ...DEFAULT_SETTINGS }),

      exportSettings: () => {
        const state = get();
        const exported = {};
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          exported[key] = state[key];
        }
        return JSON.stringify(exported, null, 2);
      },

      importSettings: (json) => {
        try {
          const parsed = JSON.parse(json);
          const validSettings = {};
          for (const key of Object.keys(DEFAULT_SETTINGS)) {
            if (key in parsed && typeof parsed[key] === typeof DEFAULT_SETTINGS[key]) {
              validSettings[key] = parsed[key];
            }
          }
          set(validSettings);
          return { success: true, count: Object.keys(validSettings).length };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export { DEFAULT_SETTINGS };
