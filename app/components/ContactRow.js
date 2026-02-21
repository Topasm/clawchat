import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../config/ThemeContext';

/**
 * ContactRow - Reusable list row component for conversation list items.
 *
 * Props:
 *  - title (string): Primary text (conversation title)
 *  - subtitle (string): Secondary text (last message preview)
 *  - onPress (function): Tap handler
 *  - timestamp (string): Formatted timestamp to display on the right
 *  - showChevron (bool): Whether to show the right chevron (default true)
 */
export default function ContactRow({
  title,
  subtitle,
  onPress,
  timestamp,
  showChevron = true,
}) {
  const { colors, typography, spacing } = useTheme();

  const initial = title ? title.charAt(0).toUpperCase() : '?';

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
    >
      <View style={[styles.avatar, { backgroundColor: colors.primary, marginRight: spacing.sm + 4 }]}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text
            style={[
              styles.title,
              typography.body,
              { color: colors.text, marginRight: spacing.sm },
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {timestamp ? (
            <Text style={[styles.timestamp, typography.caption, { color: colors.textSecondary }]}>
              {timestamp}
            </Text>
          ) : null}
        </View>
        {subtitle ? (
          <Text
            style={[
              styles.subtitle,
              typography.caption,
              { color: colors.textSecondary, fontSize: 14 },
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {showChevron && (
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.disabled}
          style={{ marginLeft: spacing.xs }}
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontWeight: '600',
    flex: 1,
  },
  timestamp: {},
  subtitle: {
    marginTop: 2,
  },
});
