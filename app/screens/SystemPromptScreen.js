import React, { useState, useLayoutEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../config/theme';
import { useSettingsStore, DEFAULT_SETTINGS } from '../stores/useSettingsStore';

const MAX_PROMPT_LENGTH = 4000;

export default function SystemPromptScreen({ navigation }) {
  const currentPrompt = useSettingsStore((s) => s.systemPrompt);
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);

  const [draft, setDraft] = useState(currentPrompt);
  const hasChanges = draft !== currentPrompt;
  const charCount = draft.length;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'System Prompt',
      headerRight: () => (
        <TouchableOpacity
          onPress={handleSave}
          disabled={!hasChanges}
          style={styles.headerButton}
        >
          <Text
            style={[
              styles.headerButtonText,
              !hasChanges && styles.headerButtonDisabled,
            ]}
          >
            Save
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, hasChanges, draft]);

  const handleSave = () => {
    setSystemPrompt(draft);
    navigation.goBack();
  };

  const handleReset = () => {
    Alert.alert(
      'Reset System Prompt',
      'This will restore the default system prompt. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setDraft(DEFAULT_SETTINGS.systemPrompt);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.description}>
            This prompt is sent at the beginning of every conversation to set the
            AI assistant's behavior and personality.
          </Text>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              value={draft}
              onChangeText={(text) => {
                if (text.length <= MAX_PROMPT_LENGTH) {
                  setDraft(text);
                }
              }}
              multiline
              textAlignVertical="top"
              placeholder="Enter your system prompt..."
              placeholderTextColor={theme.colors.disabled}
              autoFocus={false}
              scrollEnabled={false}
            />
          </View>

          <View style={styles.footer}>
            <Text style={styles.charCount}>
              {charCount} / {MAX_PROMPT_LENGTH}
            </Text>
            {hasChanges ? (
              <Text style={styles.unsavedLabel}>Unsaved changes</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.resetButton}
            onPress={handleReset}
            activeOpacity={0.6}
          >
            <Text style={styles.resetButtonText}>Reset to Default</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: theme.spacing.md,
  },
  description: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    lineHeight: 20,
    marginBottom: theme.spacing.md,
  },
  inputContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 200,
  },
  textInput: {
    fontSize: 15,
    color: theme.colors.text,
    padding: theme.spacing.sm + 4,
    lineHeight: 22,
    minHeight: 200,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  charCount: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  unsavedLabel: {
    fontSize: 13,
    color: theme.colors.warning,
    fontWeight: '500',
  },
  resetButton: {
    marginTop: theme.spacing.lg,
    alignSelf: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  resetButtonText: {
    fontSize: 15,
    color: theme.colors.error,
    fontWeight: '500',
  },
  headerButton: {
    marginRight: theme.spacing.md,
  },
  headerButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  headerButtonDisabled: {
    color: theme.colors.disabled,
  },
});
