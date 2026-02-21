import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../config/ThemeContext';

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
  const { colors, typography, spacing, borderRadius } = useTheme();

  const textColor = danger ? colors.error : colors.text;
  const iconColor = danger ? colors.error : colors.primary;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          paddingVertical: spacing.sm + 4,
          paddingHorizontal: spacing.md,
          backgroundColor: colors.surface,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      {iconName ? (
        <View
          style={[
            styles.iconWrapper,
            {
              borderRadius: borderRadius.md,
              backgroundColor: colors.surfaceSecondary,
              marginRight: spacing.sm + 4,
            },
          ]}
        >
          <Ionicons name={iconName} size={22} color={iconColor} />
        </View>
      ) : null}

      <View style={styles.content}>
        <Text style={[styles.title, typography.body, { color: textColor }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, typography.caption, { color: colors.textSecondary }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {showChevron && onPress ? (
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.disabled}
        />
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrapper: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {},
  subtitle: {
    marginTop: 2,
  },
});
