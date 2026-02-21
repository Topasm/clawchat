import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../config/ThemeContext';
import { useAuthStore } from '../stores/useAuthStore';
import Cell from '../components/Cell';
import Separator from '../components/Separator';

const APP_VERSION = '0.1.0';

export default function SettingsScreen() {
  const { colors, typography, spacing } = useTheme();

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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Connection Section */}
        <Text
          style={[
            styles.sectionHeader,
            typography.caption,
            {
              color: colors.textSecondary,
              paddingHorizontal: spacing.md,
              paddingTop: spacing.lg,
              paddingBottom: spacing.sm,
            },
          ]}
        >
          CONNECTION
        </Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Cell
            title="Server"
            subtitle={serverUrl || 'Not connected'}
            iconName="server-outline"
            showChevron={false}
          />
        </View>

        {/* About Section */}
        <Text
          style={[
            styles.sectionHeader,
            typography.caption,
            {
              color: colors.textSecondary,
              paddingHorizontal: spacing.md,
              paddingTop: spacing.lg,
              paddingBottom: spacing.sm,
            },
          ]}
        >
          ABOUT
        </Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
        <Text
          style={[
            styles.sectionHeader,
            typography.caption,
            {
              color: colors.textSecondary,
              paddingHorizontal: spacing.md,
              paddingTop: spacing.lg,
              paddingBottom: spacing.sm,
            },
          ]}
        >
          ACCOUNT
        </Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
  },
  container: {
    flex: 1,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
