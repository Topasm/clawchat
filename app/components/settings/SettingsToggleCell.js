import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../config/theme';

/**
 * SettingsToggleCell - A settings row with a label, icon, and toggle switch.
 *
 * Props:
 *  - label (string): Primary label text
 *  - value (bool): Current toggle state
 *  - onValueChange (function): Called when toggle changes
 *  - iconName (string): Ionicons icon name
 *  - iconColor (string): Icon tint color (defaults to primary)
 *  - disabled (bool): Whether the cell is disabled
 *  - showSeparator (bool): Show bottom separator line (default true)
 */
export default function SettingsToggleCell({
  label,
  value,
  onValueChange,
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
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{
            false: theme.colors.border,
            true: theme.colors.primaryLight,
          }}
          thumbColor={value ? theme.colors.primary : '#f4f3f4'}
          ios_backgroundColor={theme.colors.border}
        />
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
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.md + 30 + theme.spacing.sm + 4,
  },
});
