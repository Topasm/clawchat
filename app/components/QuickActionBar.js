import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../config/theme';

const ACTIONS = [
  { key: 'task', label: 'New Task', icon: 'add-circle-outline', prefix: 'Create task: ' },
  { key: 'schedule', label: 'Schedule', icon: 'calendar-outline', prefix: 'Schedule ' },
  { key: 'note', label: 'Note', icon: 'document-text-outline', prefix: 'Note: ' },
  { key: 'plan', label: "Today's Plan", icon: 'today-outline', prefix: "What's my plan for today?" },
];

export default function QuickActionBar({ onSelectAction }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {ACTIONS.map((action) => (
        <TouchableOpacity
          key={action.key}
          style={styles.chip}
          onPress={() => onSelectAction?.(action)}
          activeOpacity={0.7}
        >
          <Ionicons name={action.icon} size={14} color={theme.colors.primary} />
          <Text style={styles.chipText}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.primary,
  },
});
