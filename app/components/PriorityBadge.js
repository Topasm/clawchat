import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '../config/theme';

const PRIORITY_COLORS = {
  urgent: theme.colors.priorityUrgent,
  high: theme.colors.priorityHigh,
  medium: theme.colors.priorityMedium,
  low: theme.colors.priorityLow,
};

export default function PriorityBadge({ priority, size = 8 }) {
  if (!priority || priority === 'medium') return null;
  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.low;

  return (
    <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />
  );
}

const styles = StyleSheet.create({
  dot: {},
});
