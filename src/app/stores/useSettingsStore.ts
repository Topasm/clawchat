import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import apiClient from '../services/apiClient';
import { isDemoMode } from '../utils/helpers';
import type { SettingsPayload } from '../types/api';

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

  // Server sync
  fetchSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
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

let _syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    useSettingsStore.getState().saveSettings();
  }, 500);
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setFontSize: (fontSize) => { set({ fontSize }); scheduleSave(); },
      setMessageBubbleStyle: (messageBubbleStyle) => { set({ messageBubbleStyle }); scheduleSave(); },
      setSendOnEnter: (sendOnEnter) => { set({ sendOnEnter }); scheduleSave(); },
      setShowTimestamps: (showTimestamps) => { set({ showTimestamps }); scheduleSave(); },
      setShowAvatars: (showAvatars) => { set({ showAvatars }); scheduleSave(); },

      setLlmModel: (llmModel) => { set({ llmModel }); scheduleSave(); },
      setTemperature: (temperature) => { set({ temperature }); scheduleSave(); },
      setSystemPrompt: (systemPrompt) => { set({ systemPrompt }); scheduleSave(); },
      setMaxTokens: (maxTokens) => { set({ maxTokens }); scheduleSave(); },
      setStreamResponses: (streamResponses) => { set({ streamResponses }); scheduleSave(); },

      setTheme: (theme) => { set({ theme }); scheduleSave(); },
      setCompactMode: (compactMode) => { set({ compactMode }); scheduleSave(); },
      setSidebarSize: (sidebarSize) => { set({ sidebarSize }); scheduleSave(); },
      setChatPanelSize: (chatPanelSize) => { set({ chatPanelSize }); scheduleSave(); },

      setNotificationsEnabled: (notificationsEnabled) => { set({ notificationsEnabled }); scheduleSave(); },
      setReminderSound: (reminderSound) => { set({ reminderSound }); scheduleSave(); },

      setSaveHistory: (saveHistory) => { set({ saveHistory }); scheduleSave(); },
      setAnalyticsEnabled: (analyticsEnabled) => { set({ analyticsEnabled }); scheduleSave(); },
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

      fetchSettings: async () => {
        if (isDemoMode()) return;
        try {
          const response = await apiClient.get('/settings');
          const serverSettings: SettingsPayload = response.data?.settings ?? response.data;
          const merge: Record<string, unknown> = {};
          for (const key of Object.keys(DEFAULT_SETTINGS) as DefaultKeys[]) {
            if (key in serverSettings && (serverSettings as Record<string, unknown>)[key] !== undefined) {
              merge[key] = (serverSettings as Record<string, unknown>)[key];
            }
          }
          if (Object.keys(merge).length > 0) {
            set(merge as Partial<SettingsState>);
          }
        } catch (err) {
          console.warn('Failed to fetch settings from server:', err);
        }
      },

      saveSettings: async () => {
        if (isDemoMode()) return;
        try {
          const state = get();
          const payload: SettingsPayload = {
            fontSize: state.fontSize,
            messageBubbleStyle: state.messageBubbleStyle,
            sendOnEnter: state.sendOnEnter,
            showTimestamps: state.showTimestamps,
            showAvatars: state.showAvatars,
            llmModel: state.llmModel,
            temperature: state.temperature,
            systemPrompt: state.systemPrompt,
            maxTokens: state.maxTokens,
            streamResponses: state.streamResponses,
            theme: state.theme,
            compactMode: state.compactMode,
            sidebarSize: state.sidebarSize,
            chatPanelSize: state.chatPanelSize,
            notificationsEnabled: state.notificationsEnabled,
            reminderSound: state.reminderSound,
            saveHistory: state.saveHistory,
            analyticsEnabled: state.analyticsEnabled,
          };
          await apiClient.put('/settings', payload);
        } catch (err) {
          console.warn('Failed to save settings to server:', err);
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
