import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../config/theme';

/**
 * SettingsNavigationCell - A tappable settings row with label, detail text, and chevron.
 *
 * Props:
 *  - label (string): Primary label text
 *  - detail (string): Secondary text shown on the right
 *  - onPress (function): Tap handler
 *  - iconName (string): Ionicons icon name
 *  - iconColor (string): Icon tint color
 *  - disabled (bool): Whether the cell is disabled
 *  - showSeparator (bool): Show bottom separator line (default true)
 */
export default function SettingsNavigationCell({
  label,
  detail,
  onPress,
  iconName,
  iconColor,
  disabled = false,
  showSeparator = true,
}) {
  const resolvedIconColor = disabled
    ? theme.colors.disabled
    : iconColor || theme.colors.primary;

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={[styles.container, disabled && styles.disabledContainer]}
        onPress={onPress}
        disabled={disabled || !onPress}
        activeOpacity={0.6}
      >
        {iconName ? (
          <View style={[styles.iconWrapper, disabled && styles.iconDisabled]}>
            <Ionicons name={iconName} size={20} color={resolvedIconColor} />
          </View>
        ) : null}
        <Text
          style={[styles.label, disabled && styles.disabledLabel]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            style={[styles.detail, disabled && styles.disabledDetail]}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
        <Ionicons
          name="chevron-forward"
          size={18}
          color={disabled ? theme.colors.disabled : theme.colors.textSecondary}
          style={styles.chevron}
        />
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
  label: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    color: theme.colors.text,
  },
  disabledLabel: {
    color: theme.colors.disabled,
  },
  detail: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    marginRight: theme.spacing.xs,
    maxWidth: 180,
  },
  disabledDetail: {
    color: theme.colors.disabled,
  },
  chevron: {
    marginLeft: theme.spacing.xs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.md + 30 + theme.spacing.sm + 4,
  },
});
