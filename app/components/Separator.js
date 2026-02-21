import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../config/ThemeContext';

/**
 * Separator - Simple horizontal line separator.
 */
export default function Separator() {
  const { colors, spacing } = useTheme();

  return (
    <View
      style={[
        styles.separator,
        { backgroundColor: colors.border, marginLeft: spacing.md },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
  },
});
