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
import { theme } from '../config/theme';
import { useAuthStore } from '../stores/useAuthStore';

export default function LoginScreen() {
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
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <Text style={styles.title}>ClawChat</Text>
          <Text style={styles.subtitle}>Connect to your server</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Server URL (e.g., https://192.168.1.100:8000)"
            placeholderTextColor={theme.colors.disabled}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
          />

          <TextInput
            style={styles.input}
            placeholder="PIN"
            placeholderTextColor={theme.colors.disabled}
            value={pin}
            onChangeText={setPin}
            secureTextEntry
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          <TouchableOpacity
            style={[styles.button, isConnecting && styles.buttonDisabled]}
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
    backgroundColor: theme.colors.background,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  title: {
    ...theme.typography.h1,
    color: theme.colors.primary,
    fontSize: 36,
    fontWeight: '700',
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  form: {
    width: '100%',
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.sm + 6,
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  buttonDisabled: {
    backgroundColor: theme.colors.disabled,
  },
  buttonText: {
    color: theme.colors.surface,
    fontSize: 18,
    fontWeight: '600',
  },
});
