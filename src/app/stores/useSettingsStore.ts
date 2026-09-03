import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import apiClient from '../services/apiClient';
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
  simpleMode: boolean;
  sidebarSize: number;
  chatPanelSize: number;

  // Notifications
  notificationsEnabled: boolean;
  reminderSound: boolean;

  // Privacy
  saveHistory: boolean;
  analyticsEnabled: boolean;

  // Security
  biometricEnabled: boolean;

  // This machine
  /** Run work addressed to this machine, on this machine. Desktop only. */
  workerEnabled: boolean;
  /** How this machine is named to the server, and in the host list. */
  workerLabel: string;
  /** Which CLI runs the work here. */
  workerProvider: string;

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
  setSimpleMode: (v: boolean) => void;
  setSidebarSize: (v: number) => void;
  setChatPanelSize: (v: number) => void;
  setNotificationsEnabled: (v: boolean) => void;
  setReminderSound: (v: boolean) => void;
  setSaveHistory: (v: boolean) => void;
  setAnalyticsEnabled: (v: boolean) => void;
  setBiometricEnabled: (v: boolean) => void;
  setWorkerEnabled: (v: boolean) => void;
  setWorkerLabel: (v: string) => void;
  setWorkerProvider: (v: string) => void;
  setStreak: (v: StreakData) => void;

  // Actions
  resetApplicationPreferences: () => void;
  exportSettings: () => string;
  importSettings: (json: string) => { success: boolean; count?: number; error?: string };

  // Server sync
  fetchSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
}

const APPLICATION_DEFAULT_SETTINGS = {
  fontSize: 16,
  messageBubbleStyle: 'modern',
  sendOnEnter: true, // desktop convention: true (mobile was false)
  showTimestamps: true,
  showAvatars: true,

  theme: 'system',
  compactMode: false,
  simpleMode: false,
  sidebarSize: 18,
  chatPanelSize: 30,

  notificationsEnabled: true,
  reminderSound: true,

  saveHistory: true,
  analyticsEnabled: false,

  biometricEnabled: false,

  // Off until someone says this machine should take work: it starts a CLI
  // with write access here, which is not a default to inherit silently.
  workerEnabled: false,
  workerLabel: '',
  workerProvider: 'claude',

  streak: { lastCompletedDate: '', currentStreak: 0 },
} as const;

const WORKSPACE_DEFAULT_SETTINGS = {
  llmModel: 'openclaw-default',
  temperature: 0.7,
  systemPrompt: 'You are a helpful assistant.',
  maxTokens: 2048,
  streamResponses: true,
} as const;

const DEFAULT_SETTINGS = {
  ...APPLICATION_DEFAULT_SETTINGS,
  ...WORKSPACE_DEFAULT_SETTINGS,
} as const;

type DefaultKeys = keyof typeof DEFAULT_SETTINGS;
type WorkspaceSettingKey =
  'llmModel' | 'temperature' | 'systemPrompt' | 'maxTokens' | 'streamResponses';

const WORKSPACE_SETTING_KEYS: readonly WorkspaceSettingKey[] = [
  'llmModel',
  'temperature',
  'systemPrompt',
  'maxTokens',
  'streamResponses',
];

let _syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWorkspaceSave() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    useSettingsStore.getState().saveSettings();
  }, 500);
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      // Application preferences are persisted locally by Zustand. They must
      // remain writable while no workspace server is available.
      setFontSize: (fontSize) => set({ fontSize }),
      setMessageBubbleStyle: (messageBubbleStyle) => set({ messageBubbleStyle }),
      setSendOnEnter: (sendOnEnter) => set({ sendOnEnter }),
      setShowTimestamps: (showTimestamps) => set({ showTimestamps }),
      setShowAvatars: (showAvatars) => set({ showAvatars }),

      // These values belong to the active workspace and are synchronized with
      // its server after the local state has been updated.
      setLlmModel: (llmModel) => {
        set({ llmModel });
        scheduleWorkspaceSave();
      },
      setTemperature: (temperature) => {
        set({ temperature });
        scheduleWorkspaceSave();
      },
      setSystemPrompt: (systemPrompt) => {
        set({ systemPrompt });
        scheduleWorkspaceSave();
      },
      setMaxTokens: (maxTokens) => {
        set({ maxTokens });
        scheduleWorkspaceSave();
      },
      setStreamResponses: (streamResponses) => {
        set({ streamResponses });
        scheduleWorkspaceSave();
      },

      setTheme: (theme) => set({ theme }),
      setCompactMode: (compactMode) => set({ compactMode }),
      setSimpleMode: (simpleMode) => set({ simpleMode }),
      setSidebarSize: (sidebarSize) => set({ sidebarSize }),
      setChatPanelSize: (chatPanelSize) => set({ chatPanelSize }),

      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setReminderSound: (reminderSound) => set({ reminderSound }),

      setSaveHistory: (saveHistory) => set({ saveHistory }),
      setAnalyticsEnabled: (analyticsEnabled) => set({ analyticsEnabled }),
      setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled }),
      setWorkerEnabled: (workerEnabled) => set({ workerEnabled }),
      setWorkerLabel: (workerLabel) => set({ workerLabel }),
      setWorkerProvider: (workerProvider) => set({ workerProvider }),
      setStreak: (streak) => set({ streak }),

      resetApplicationPreferences: () => set({ ...APPLICATION_DEFAULT_SETTINGS }),

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
        try {
          const response = await apiClient.get('/settings');
          const serverSettings: SettingsPayload = response.data?.settings ?? response.data;
          const merge: Record<string, unknown> = {};
          for (const key of WORKSPACE_SETTING_KEYS) {
            if (
              key in serverSettings &&
              (serverSettings as Record<string, unknown>)[key] !== undefined
            ) {
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
        try {
          const state = get();
          const payload: SettingsPayload = {
            llmModel: state.llmModel,
            temperature: state.temperature,
            systemPrompt: state.systemPrompt,
            maxTokens: state.maxTokens,
            streamResponses: state.streamResponses,
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
