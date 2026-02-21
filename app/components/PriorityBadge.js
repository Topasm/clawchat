import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../config/ThemeContext';

export default function PriorityBadge({ priority, size = 8 }) {
  const { colors } = useTheme();

  if (!priority || priority === 'medium') return null;

  const PRIORITY_COLORS = {
    urgent: colors.priorityUrgent,
    high: colors.priorityHigh,
    medium: colors.priorityMedium,
    low: colors.priorityLow,
  };

  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.low;

  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
});
