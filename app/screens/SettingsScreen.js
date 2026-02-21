import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../config/ThemeContext';

// Clipboard: try expo-clipboard, fall back to react-native Clipboard
let ClipboardModule = null;
try {
  ClipboardModule = require('expo-clipboard');
} catch {
  try {
    ClipboardModule = require('react-native').Clipboard;
  } catch {
    // No clipboard available
  }
}
import { useAuthStore } from '../stores/useAuthStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  SettingsToggleCell,
  SettingsSliderCell,
  SettingsNavigationCell,
  SettingsButtonCell,
  SettingsDetailCell,
  SettingsSegmentedCell,
} from '../components/settings';

const APP_VERSION = '0.1.0';

const THEME_OPTIONS = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'System', value: 'system' },
];

const BUBBLE_STYLE_OPTIONS = [
  { label: 'Modern', value: 'modern' },
  { label: 'Classic', value: 'classic' },
  { label: 'Minimal', value: 'minimal' },
];

export default function SettingsScreen({ navigation }) {
  const { colors, setMode } = useTheme();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const logout = useAuthStore((s) => s.logout);

  // Settings store values
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const messageBubbleStyle = useSettingsStore((s) => s.messageBubbleStyle);
  const setMessageBubbleStyle = useSettingsStore((s) => s.setMessageBubbleStyle);
  const sendOnEnter = useSettingsStore((s) => s.sendOnEnter);
  const setSendOnEnter = useSettingsStore((s) => s.setSendOnEnter);
  const showTimestamps = useSettingsStore((s) => s.showTimestamps);
  const setShowTimestamps = useSettingsStore((s) => s.setShowTimestamps);
  const showAvatars = useSettingsStore((s) => s.showAvatars);
  const setShowAvatars = useSettingsStore((s) => s.setShowAvatars);

  const llmModel = useSettingsStore((s) => s.llmModel);
  const setLlmModel = useSettingsStore((s) => s.setLlmModel);
  const temperature = useSettingsStore((s) => s.temperature);
  const setTemperature = useSettingsStore((s) => s.setTemperature);
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const maxTokens = useSettingsStore((s) => s.maxTokens);
  const setMaxTokens = useSettingsStore((s) => s.setMaxTokens);
  const streamResponses = useSettingsStore((s) => s.streamResponses);
  const setStreamResponses = useSettingsStore((s) => s.setStreamResponses);

  const appTheme = useSettingsStore((s) => s.theme);
  const setAppTheme = useSettingsStore((s) => s.setTheme);
  const compactMode = useSettingsStore((s) => s.compactMode);
  const setCompactMode = useSettingsStore((s) => s.setCompactMode);

  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const reminderSound = useSettingsStore((s) => s.reminderSound);
  const setReminderSound = useSettingsStore((s) => s.setReminderSound);

  const exportSettings = useSettingsStore((s) => s.exportSettings);
  const importSettings = useSettingsStore((s) => s.importSettings);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  const [serverHealth, setServerHealth] = useState(null);
  const [cacheSize, setCacheSize] = useState('Calculating...');

  const [localFontSize, setLocalFontSize] = useState(fontSize);
  const [localTemperature, setLocalTemperature] = useState(temperature);
  const [localMaxTokens, setLocalMaxTokens] = useState(maxTokens);

  useEffect(() => { setLocalFontSize(fontSize); }, [fontSize]);
  useEffect(() => { setLocalTemperature(temperature); }, [temperature]);
  useEffect(() => { setLocalMaxTokens(maxTokens); }, [maxTokens]);

  useEffect(() => {
    checkServerHealth();
    estimateCacheSize();
  }, []);

  const handleThemeChange = useCallback((value) => {
    setAppTheme(value);
    setMode(value);
  }, [setAppTheme, setMode]);

  const checkServerHealth = useCallback(async () => {
    if (!serverUrl) { setServerHealth(false); return; }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${serverUrl}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      setServerHealth(response.ok);
    } catch { setServerHealth(false); }
  }, [serverUrl]);

  const estimateCacheSize = useCallback(async () => {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const keys = await AsyncStorage.getAllKeys();
      let totalSize = 0;
      for (const key of keys) {
        const value = await AsyncStorage.getItem(key);
        if (value) totalSize += value.length * 2;
      }
      if (totalSize < 1024) setCacheSize(`${totalSize} B`);
      else if (totalSize < 1024 * 1024) setCacheSize(`${(totalSize / 1024).toFixed(1)} KB`);
      else setCacheSize(`${(totalSize / (1024 * 1024)).toFixed(1)} MB`);
    } catch { setCacheSize('Unknown'); }
  }, []);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to disconnect from the server?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const handleEditModel = () => {
    Alert.prompt
      ? Alert.prompt('LLM Model', 'Enter the model name:', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save', onPress: (text) => { if (text && text.trim()) setLlmModel(text.trim()); } },
        ], 'plain-text', llmModel)
      : Alert.alert('LLM Model', `Current model: ${llmModel}\n\nTo change the model, edit the settings JSON via Export/Import.`, [{ text: 'OK' }]);
  };

  const copyToClipboard = async (text) => {
    if (ClipboardModule?.setStringAsync) { await ClipboardModule.setStringAsync(text); return true; }
    else if (ClipboardModule?.setString) { ClipboardModule.setString(text); return true; }
    return false;
  };

  const readFromClipboard = async () => {
    if (ClipboardModule?.getStringAsync) return await ClipboardModule.getStringAsync();
    else if (ClipboardModule?.getString) return await ClipboardModule.getString();
    return '';
  };

  const handleExportSettings = async () => {
    try {
      const json = exportSettings();
      const copied = await copyToClipboard(json);
      if (copied) Alert.alert('Exported', 'Settings copied to clipboard as JSON.');
      else Alert.alert('Settings JSON', json);
    } catch { Alert.alert('Error', 'Failed to export settings.'); }
  };

  const handleImportSettings = async () => {
    try {
      const clipboardContent = await readFromClipboard();
      if (!clipboardContent || !clipboardContent.trim()) {
        Alert.alert('Import Failed', 'No valid JSON found in clipboard.');
        return;
      }
      Alert.alert('Import Settings', 'This will overwrite your current settings with the JSON from your clipboard. Continue?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: () => {
            const result = importSettings(clipboardContent);
            if (result.success) Alert.alert('Imported', `Successfully imported ${result.count} settings.`);
            else Alert.alert('Import Failed', result.error || 'Invalid JSON format.');
          },
        },
      ]);
    } catch { Alert.alert('Error', 'Failed to read clipboard.'); }
  };

  const handleClearChatHistory = () => {
    Alert.alert('Clear Chat History', 'This will permanently delete all local chat history. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          try {
            const { useChatStore } = require('../stores/useChatStore');
            useChatStore.getState().setMessages([]);
            useChatStore.getState().setConversations([]);
            Alert.alert('Cleared', 'Chat history has been cleared.');
          } catch { Alert.alert('Error', 'Failed to clear chat history.'); }
        },
      },
    ]);
  };

  const handleClearCache = () => {
    Alert.alert('Clear Cache', 'This will clear locally cached data. Your settings and account will not be affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          try {
            const AsyncStorage = require('@react-native-async-storage/async-storage').default;
            const keys = await AsyncStorage.getAllKeys();
            const cacheKeys = keys.filter((k) => !k.includes('auth-storage') && !k.includes('settings-storage'));
            if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys);
            setCacheSize('0 B');
            Alert.alert('Cleared', 'Cache has been cleared.');
          } catch { Alert.alert('Error', 'Failed to clear cache.'); }
        },
      },
    ]);
  };

  const handleResetSettings = () => {
    Alert.alert('Reset All Settings', 'This will restore all settings to their default values. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset', style: 'destructive',
        onPress: () => { resetToDefaults(); Alert.alert('Reset', 'All settings have been restored to defaults.'); },
      },
    ]);
  };

  const handleSystemPrompt = () => { navigation.navigate('SystemPrompt'); };

  const sections = [
    {
      key: 'chat', title: 'CHAT',
      data: [
        { key: 'fontSize', render: () => (<SettingsSliderCell label="Font Size" value={localFontSize} onValueChange={setLocalFontSize} onSlidingComplete={(val) => setFontSize(Math.round(val))} minimumValue={12} maximumValue={24} step={1} formatValue={(v) => `${Math.round(v)}pt`} iconName="text-outline" showSeparator />) },
        { key: 'messageBubbleStyle', render: () => (<SettingsSegmentedCell label="Message Style" options={BUBBLE_STYLE_OPTIONS} selectedValue={messageBubbleStyle} onValueChange={setMessageBubbleStyle} iconName="chatbubble-ellipses-outline" showSeparator />) },
        { key: 'sendOnEnter', render: () => (<SettingsToggleCell label="Send on Enter" value={sendOnEnter} onValueChange={setSendOnEnter} iconName="return-down-back-outline" showSeparator />) },
        { key: 'showTimestamps', render: () => (<SettingsToggleCell label="Show Timestamps" value={showTimestamps} onValueChange={setShowTimestamps} iconName="time-outline" showSeparator />) },
        { key: 'showAvatars', render: () => (<SettingsToggleCell label="Show Avatars" value={showAvatars} onValueChange={setShowAvatars} iconName="person-circle-outline" showSeparator={false} />) },
      ],
    },
    {
      key: 'llm', title: 'LLM CONFIGURATION',
      data: [
        { key: 'llmModel', render: () => (<SettingsNavigationCell label="Model" detail={llmModel} onPress={handleEditModel} iconName="hardware-chip-outline" showSeparator />) },
        { key: 'temperature', render: () => (<SettingsSliderCell label="Temperature" value={localTemperature} onValueChange={setLocalTemperature} onSlidingComplete={(val) => setTemperature(Math.round(val * 10) / 10)} minimumValue={0} maximumValue={2} step={0.1} formatValue={(v) => (Math.round(v * 10) / 10).toFixed(1)} iconName="thermometer-outline" showSeparator />) },
        { key: 'systemPrompt', render: () => (<SettingsNavigationCell label="System Prompt" detail={systemPrompt.length > 30 ? systemPrompt.substring(0, 30) + '...' : systemPrompt} onPress={handleSystemPrompt} iconName="document-text-outline" showSeparator />) },
        { key: 'maxTokens', render: () => (<SettingsSliderCell label="Max Tokens" value={localMaxTokens} onValueChange={setLocalMaxTokens} onSlidingComplete={(val) => setMaxTokens(Math.round(val))} minimumValue={256} maximumValue={8192} step={256} formatValue={(v) => String(Math.round(v))} iconName="swap-horizontal-outline" showSeparator />) },
        { key: 'streamResponses', render: () => (<SettingsToggleCell label="Stream Responses" value={streamResponses} onValueChange={setStreamResponses} iconName="pulse-outline" showSeparator={false} />) },
      ],
    },
    {
      key: 'appearance', title: 'APPEARANCE',
      data: [
        { key: 'theme', render: () => (<SettingsSegmentedCell label="Theme" options={THEME_OPTIONS} selectedValue={appTheme} onValueChange={handleThemeChange} iconName="color-palette-outline" showSeparator />) },
        { key: 'compactMode', render: () => (<SettingsToggleCell label="Compact Mode" value={compactMode} onValueChange={setCompactMode} iconName="contract-outline" showSeparator={false} />) },
      ],
    },
    {
      key: 'notifications', title: 'NOTIFICATIONS',
      data: [
        { key: 'notificationsEnabled', render: () => (<SettingsToggleCell label="Enable Notifications" value={notificationsEnabled} onValueChange={setNotificationsEnabled} iconName="notifications-outline" showSeparator />) },
        { key: 'reminderSound', render: () => (<SettingsToggleCell label="Reminder Sound" value={reminderSound} onValueChange={setReminderSound} iconName="volume-high-outline" disabled={!notificationsEnabled} showSeparator={false} />) },
      ],
    },
    {
      key: 'data', title: 'DATA & STORAGE',
      data: [
        { key: 'exportSettings', render: () => (<SettingsButtonCell label="Export Settings" onPress={handleExportSettings} iconName="share-outline" subtitle="Copy settings JSON to clipboard" showSeparator />) },
        { key: 'importSettings', render: () => (<SettingsButtonCell label="Import Settings" onPress={handleImportSettings} iconName="download-outline" subtitle="Paste settings JSON from clipboard" showSeparator />) },
        { key: 'clearChatHistory', render: () => (<SettingsButtonCell label="Clear Chat History" onPress={handleClearChatHistory} iconName="chatbubbles-outline" destructive showSeparator />) },
        { key: 'clearCache', render: () => (<SettingsButtonCell label="Clear Cache" onPress={handleClearCache} iconName="trash-outline" subtitle={cacheSize} destructive showSeparator />) },
        { key: 'resetSettings', render: () => (<SettingsButtonCell label="Reset All Settings" onPress={handleResetSettings} iconName="refresh-outline" destructive showSeparator={false} />) },
      ],
    },
    {
      key: 'about', title: 'ABOUT',
      data: [
        { key: 'version', render: () => (<SettingsDetailCell label="Version" value={APP_VERSION} iconName="information-circle-outline" showSeparator />) },
        { key: 'serverUrl', render: () => (<SettingsDetailCell label="Server URL" value={serverUrl || 'Not connected'} iconName="server-outline" showSeparator />) },
        { key: 'serverHealth', render: () => (<SettingsDetailCell label="Server Health" value={serverHealth === null ? 'Checking...' : serverHealth ? 'Connected' : 'Disconnected'} statusColor={serverHealth === null ? colors.warning : serverHealth ? colors.success : colors.error} iconName="pulse-outline" showSeparator />) },
        { key: 'debugLogs', render: () => (<SettingsNavigationCell label="Debug Logs" detail="Coming Soon" iconName="bug-outline" disabled showSeparator={false} />) },
      ],
    },
    {
      key: 'account', title: 'ACCOUNT',
      data: [
        { key: 'logout', render: () => (<SettingsButtonCell label="Logout" onPress={handleLogout} iconName="log-out-outline" destructive showSeparator={false} />) },
      ],
    },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <SectionList
        style={[styles.container, { backgroundColor: colors.background }]}
        sections={sections}
        renderItem={({ item }) => item.render()}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{section.title}</Text>
        )}
        renderSectionFooter={() => null}
        keyExtractor={(item) => item.key}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.contentContainer}
        ListFooterComponent={<View style={styles.listFooter} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  contentContainer: { paddingBottom: 32 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listFooter: { height: 32 },
});
