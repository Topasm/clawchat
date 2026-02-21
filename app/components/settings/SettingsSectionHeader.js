import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { theme } from '../../config/theme';

/**
 * SettingsSectionHeader - Uppercase section title for grouped settings.
 *
 * Props:
 *  - title (string): Section title text
 */
export default function SettingsSectionHeader({ title }) {
  return <Text style={styles.header}>{title}</Text>;
}

const styles = StyleSheet.create({
  header: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
