import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../config/theme';

/**
 * SettingsSegmentedCell - A settings row with a segmented control for multi-option selection.
 *
 * Props:
 *  - label (string): Primary label text
 *  - options (Array<{ label: string, value: string }>): Segment options
 *  - selectedValue (string): Currently selected value
 *  - onValueChange (function): Called with the new value when a segment is tapped
 *  - iconName (string): Ionicons icon name
 *  - iconColor (string): Icon tint color
 *  - disabled (bool): Whether the cell is disabled
 *  - showSeparator (bool): Show bottom separator line (default true)
 */
export default function SettingsSegmentedCell({
  label,
  options = [],
  selectedValue,
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
        <View style={styles.topRow}>
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
        </View>
        <View style={styles.segmentRow}>
          <View style={styles.segmentContainer}>
            {options.map((option, index) => {
              const isSelected = option.value === selectedValue;
              const isFirst = index === 0;
              const isLast = index === options.length - 1;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.segment,
                    isFirst && styles.segmentFirst,
                    isLast && styles.segmentLast,
                    isSelected && styles.segmentSelected,
                  ]}
                  onPress={() => !disabled && onValueChange(option.value)}
                  activeOpacity={disabled ? 1 : 0.6}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      isSelected && styles.segmentTextSelected,
                      disabled && styles.disabledLabel,
                    ]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
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
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  disabledContainer: {
    opacity: 0.5,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
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
  segmentRow: {
    paddingLeft: 30 + theme.spacing.sm + 4,
  },
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.background,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  segment: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  segmentFirst: {
    borderTopLeftRadius: theme.borderRadius.md - 1,
    borderBottomLeftRadius: theme.borderRadius.md - 1,
  },
  segmentLast: {
    borderTopRightRadius: theme.borderRadius.md - 1,
    borderBottomRightRadius: theme.borderRadius.md - 1,
    borderRightWidth: 0,
  },
  segmentSelected: {
    backgroundColor: theme.colors.primary,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.text,
  },
  segmentTextSelected: {
    color: '#FFFFFF',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.md + 30 + theme.spacing.sm + 4,
  },
});
