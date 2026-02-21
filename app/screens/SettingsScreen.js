import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../config/theme';
import { useAuthStore } from '../stores/useAuthStore';
import Cell from '../components/Cell';
import Separator from '../components/Separator';

const APP_VERSION = '0.1.0';

export default function SettingsScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to disconnect from the server?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => logout(),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView style={styles.container}>
        {/* Connection Section */}
        <Text style={styles.sectionHeader}>CONNECTION</Text>
        <View style={styles.section}>
          <Cell
            title="Server"
            subtitle={serverUrl || 'Not connected'}
            iconName="server-outline"
            showChevron={false}
          />
        </View>

        {/* About Section */}
        <Text style={styles.sectionHeader}>ABOUT</Text>
        <View style={styles.section}>
          <Cell
            title="Version"
            subtitle={APP_VERSION}
            iconName="information-circle-outline"
            showChevron={false}
          />
          <Separator />
          <Cell
            title="ClawChat"
            subtitle="Personal AI assistant"
            iconName="paw-outline"
            showChevron={false}
          />
        </View>

        {/* Account Section */}
        <Text style={styles.sectionHeader}>ACCOUNT</Text>
        <View style={styles.section}>
          <Cell
            title="Logout"
            iconName="log-out-outline"
            onPress={handleLogout}
            danger
            showChevron={false}
          />
        </View>
      </ScrollView>
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
    backgroundColor: theme.colors.background,
  },
  sectionHeader: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: theme.colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
});
