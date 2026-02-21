import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../config/ThemeContext';
import { useAuthStore } from '../stores/useAuthStore';

export default function LoginScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();

  const [serverUrl, setServerUrl] = useState('');
  const [pin, setPin] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const login = useAuthStore((s) => s.login);

  const handleLogin = async () => {
    const trimmedUrl = serverUrl.trim().replace(/\/+$/, '');
    const trimmedPin = pin.trim();

    if (!trimmedUrl) {
      Alert.alert('Missing Server URL', 'Please enter your server URL.');
      return;
    }
    if (!trimmedPin) {
      Alert.alert('Missing PIN', 'Please enter your PIN.');
      return;
    }

    setIsConnecting(true);
    try {
      await login(trimmedUrl, trimmedPin);
    } catch (error) {
      Alert.alert(
        'Connection failed',
        error.message || 'Check your server URL and PIN.'
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={[styles.container, { paddingHorizontal: spacing.xl }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.header, { marginBottom: spacing.xl }]}>
          <Text
            style={[
              styles.title,
              typography.h1,
              { color: colors.primary, marginBottom: spacing.sm },
            ]}
          >
            ClawChat
          </Text>
          <Text style={[styles.subtitle, typography.body, { color: colors.textSecondary }]}>
            Connect to your server
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: borderRadius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm + 4,
                color: colors.text,
                marginBottom: spacing.md,
              },
            ]}
            placeholder="Server URL (e.g., https://192.168.1.100:8000)"
            placeholderTextColor={colors.disabled}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
          />

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: borderRadius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm + 4,
                color: colors.text,
                marginBottom: spacing.md,
              },
            ]}
            placeholder="PIN"
            placeholderTextColor={colors.disabled}
            value={pin}
            onChangeText={setPin}
            secureTextEntry
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          <TouchableOpacity
            style={[
              styles.button,
              {
                backgroundColor: isConnecting ? colors.disabled : colors.primary,
                borderRadius: borderRadius.md,
                marginTop: spacing.sm,
              },
            ]}
            onPress={handleLogin}
            disabled={isConnecting}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
  },
  subtitle: {},
  form: {
    width: '100%',
  },
  input: {
    borderWidth: 1,
    fontSize: 16,
  },
  button: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
