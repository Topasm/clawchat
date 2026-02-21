import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../config/theme';

/**
 * SettingsButtonCell - A tappable button row for actions (e.g., export, clear, logout).
 *
 * Props:
 *  - label (string): Button text
 *  - onPress (function): Tap handler
 *  - iconName (string): Ionicons icon name
 *  - iconColor (string): Icon tint color
 *  - destructive (bool): Use red/error styling (default false)
 *  - centered (bool): Center the label text (default false)
 *  - subtitle (string): Optional subtitle text below the label
 *  - disabled (bool): Whether the cell is disabled
 *  - showSeparator (bool): Show bottom separator line (default true)
 */
export default function SettingsButtonCell({
  label,
  onPress,
  iconName,
  iconColor,
  destructive = false,
  centered = false,
  subtitle,
  disabled = false,
  showSeparator = true,
}) {
  const textColor = disabled
    ? theme.colors.disabled
    : destructive
      ? theme.colors.error
      : theme.colors.primary;

  const resolvedIconColor = disabled
    ? theme.colors.disabled
    : iconColor || (destructive ? theme.colors.error : theme.colors.primary);

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={[styles.container, disabled && styles.disabledContainer]}
        onPress={onPress}
        disabled={disabled || !onPress}
        activeOpacity={0.6}
      >
        {iconName && !centered ? (
          <View
            style={[
              styles.iconWrapper,
              disabled && styles.iconDisabled,
              destructive && !disabled && styles.iconDestructive,
            ]}
          >
            <Ionicons name={iconName} size={20} color={resolvedIconColor} />
          </View>
        ) : null}
        <View style={[styles.content, centered && styles.centeredContent]}>
          <Text style={[styles.label, { color: textColor }]}>{label}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, disabled && styles.disabledSubtitle]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
      {showSeparator && <View style={styles.separator} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: theme.colors.surface,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  disabledContainer: {
    opacity: 0.5,
  },
  iconWrapper: {
    width: 30,
    height: 30,
    borderRadius: theme.borderRadius.sm + 2,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.sm + 4,
  },
  iconDisabled: {
    backgroundColor: theme.colors.border,
  },
  iconDestructive: {
    backgroundColor: '#FFF0EF',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  centeredContent: {
    alignItems: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '400',
  },
  subtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  disabledSubtitle: {
    color: theme.colors.disabled,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.md + 30 + theme.spacing.sm + 4,
  },
});
