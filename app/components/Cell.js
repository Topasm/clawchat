import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../config/theme';

/**
 * Cell - Settings menu cell component.
 *
 * Props:
 *  - title (string): Primary label
 *  - subtitle (string): Optional secondary label
 *  - iconName (string): Ionicons icon name
 *  - onPress (function): Tap handler
 *  - showChevron (bool): Whether to show a right chevron (default true)
 *  - danger (bool): Whether to style text in red/error color (default false)
 */
export default function Cell({
  title,
  subtitle,
  iconName,
  onPress,
  showChevron = true,
  danger = false,
}) {
  const textColor = danger ? theme.colors.error : theme.colors.text;
  const iconColor = danger ? theme.colors.error : theme.colors.primary;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      {iconName ? (
        <View style={styles.iconWrapper}>
          <Ionicons name={iconName} size={22} color={iconColor} />
        </View>
      ) : null}

      <View style={styles.content}>
        <Text style={[styles.title, { color: textColor }]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {showChevron && onPress ? (
        <Ionicons
          name="chevron-forward"
          size={20}
          color={theme.colors.disabled}
        />
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm + 4,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.sm + 4,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    ...theme.typography.body,
  },
  subtitle: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
});
