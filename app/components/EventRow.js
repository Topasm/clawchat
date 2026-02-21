import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../config/ThemeContext';
import { formatTime } from '../utils/formatters';

export default function EventRow({ event, onPress }) {
  const { colors } = useTheme();

  const timeText = event.is_all_day ? 'All day' : formatTime(event.start_time);

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.surface }]}
      onPress={() => onPress?.(event)}
      activeOpacity={0.7}
    >
      <View style={[styles.timeBar, { backgroundColor: colors.todayBlue }]} />
      <View style={styles.timeContainer}>
        <Text style={[styles.time, { color: colors.todayBlue }]}>{timeText}</Text>
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {event.title}
        </Text>
        {event.location ? (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.location, { color: colors.textSecondary }]} numberOfLines={1}>
              {event.location}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  timeBar: {
    width: 3,
    height: 36,
    borderRadius: 1.5,
    marginRight: 10,
  },
  timeContainer: {
    width: 60,
    marginRight: 8,
  },
  time: {
    fontSize: 13,
    fontWeight: '500',
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '400',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  location: {
    fontSize: 13,
    marginLeft: 4,
  },
});
