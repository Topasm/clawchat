import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../config/theme';

export default function SectionHeader({ title, count, rightAction }) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <Text style={styles.title}>{title}</Text>
        {count != null && <Text style={styles.count}>{count}</Text>}
      </View>
      {rightAction && (
        <TouchableOpacity onPress={rightAction.onPress}>
          <Text style={styles.action}>{rightAction.label}</Text>
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
    backgroundColor: theme.colors.background,
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
    color: theme.colors.textSecondary,
  },
  count: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    marginLeft: 6,
  },
  action: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.primary,
  },
});
