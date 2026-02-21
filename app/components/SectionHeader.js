import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../config/ThemeContext';

export default function SectionHeader({ title, count, rightAction }) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.left}>
        <Text style={[styles.title, { color: colors.textSecondary }]}>{title}</Text>
        {count != null && (
          <Text style={[styles.count, { color: colors.textSecondary }]}>{count}</Text>
        )}
      </View>
      {rightAction && (
        <TouchableOpacity onPress={rightAction.onPress}>
          <Text style={[styles.action, { color: colors.primary }]}>{rightAction.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  count: {
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 6,
  },
  action: {
    fontSize: 14,
    fontWeight: '500',
  },
});
