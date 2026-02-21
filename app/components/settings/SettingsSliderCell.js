import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../config/theme';
import CustomSlider from './CustomSlider';

/**
 * SettingsSliderCell - A settings row with label, value display, and slider.
 *
 * Props:
 *  - label (string): Primary label text
 *  - value (number): Current slider value
 *  - onValueChange (function): Called continuously as slider moves
 *  - onSlidingComplete (function): Called when user releases slider
 *  - minimumValue (number): Slider minimum
 *  - maximumValue (number): Slider maximum
 *  - step (number): Slider step increment (default 1)
 *  - formatValue (function): Formats value for display (default: toString)
 *  - iconName (string): Ionicons icon name
 *  - iconColor (string): Icon tint color
 *  - disabled (bool): Whether the cell is disabled
 *  - showSeparator (bool): Show bottom separator line (default true)
 */
export default function SettingsSliderCell({
  label,
  value,
  onValueChange,
  onSlidingComplete,
  minimumValue = 0,
  maximumValue = 100,
  step = 1,
  formatValue,
  iconName,
  iconColor,
  disabled = false,
  showSeparator = true,
}) {
  const displayValue = formatValue ? formatValue(value) : String(value);
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
          <Text style={[styles.valueText, disabled && styles.disabledLabel]}>
            {displayValue}
          </Text>
        </View>
        <View style={styles.sliderRow}>
          <CustomSlider
            value={value}
            onValueChange={onValueChange}
            onSlidingComplete={onSlidingComplete}
            minimumValue={minimumValue}
            maximumValue={maximumValue}
            step={step}
            minimumTrackTintColor={theme.colors.primary}
            maximumTrackTintColor={theme.colors.border}
            thumbTintColor={theme.colors.primary}
            disabled={disabled}
          />
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
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  disabledContainer: {
    opacity: 0.5,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  valueText: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.primary,
    marginLeft: theme.spacing.sm,
  },
  sliderRow: {
    paddingLeft: 30 + theme.spacing.sm + 4,
    paddingRight: theme.spacing.xs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.md + 30 + theme.spacing.sm + 4,
  },
});
