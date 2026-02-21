import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../config/theme';

/**
 * SettingsDetailCell - A read-only settings row showing a label and value.
 *
 * Props:
 *  - label (string): Primary label text
 *  - value (string): Read-only value text displayed on the right
 *  - iconName (string): Ionicons icon name
 *  - iconColor (string): Icon tint color
 *  - statusColor (string): Optional status indicator dot color (e.g., green/red for health)
 *  - disabled (bool): Whether the cell is disabled
 *  - showSeparator (bool): Show bottom separator line (default true)
 */
export default function SettingsDetailCell({
  label,
  value,
  iconName,
  iconColor,
  statusColor,
  disabled = false,
  showSeparator = true,
}) {
  const resolvedIconColor = disabled
    ? theme.colors.disabled
    : iconColor || theme.colors.primary;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.container, disabled && styles.disabledContainer]}>
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
        <View style={styles.valueRow}>
          {statusColor ? (
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          ) : null}
          <Text
            style={[styles.value, disabled && styles.disabledValue]}
            numberOfLines={1}
          >
            {value}
          </Text>
        </View>
      </View>
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
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  value: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    maxWidth: 200,
  },
  disabledValue: {
    color: theme.colors.disabled,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.md + 30 + theme.spacing.sm + 4,
  },
});
