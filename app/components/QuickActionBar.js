import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../config/ThemeContext';

const ACTIONS = [
  { key: 'task', label: 'New Task', icon: 'add-circle-outline', prefix: 'Create task: ' },
  { key: 'schedule', label: 'Schedule', icon: 'calendar-outline', prefix: 'Schedule ' },
  { key: 'note', label: 'Note', icon: 'document-text-outline', prefix: 'Note: ' },
  { key: 'plan', label: "Today's Plan", icon: 'today-outline', prefix: "What's my plan for today?" },
];

export default function QuickActionBar({ onSelectAction }) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {ACTIONS.map((action) => (
        <TouchableOpacity
          key={action.key}
          style={[
            styles.chip,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
          onPress={() => onSelectAction?.(action)}
          activeOpacity={0.7}
        >
          <Ionicons name={action.icon} size={14} color={colors.primary} />
          <Text style={[styles.chipText, { color: colors.primary }]}>{action.label}</Text>
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
    borderWidth: 1,
    gap: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
