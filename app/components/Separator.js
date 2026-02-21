import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '../config/theme';

/**
 * Separator - Simple horizontal line separator.
 */
export default function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.md,
  },
});
