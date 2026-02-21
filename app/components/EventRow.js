import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../config/theme';
import { formatTime } from '../utils/formatters';

export default function EventRow({ event, onPress }) {
  const timeText = event.is_all_day ? 'All day' : formatTime(event.start_time);

  return (
    <TouchableOpacity style={styles.container} onPress={() => onPress?.(event)} activeOpacity={0.7}>
      <View style={styles.timeBar} />
      <View style={styles.timeContainer}>
        <Text style={styles.time}>{timeText}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>{event.title}</Text>
        {event.location ? (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={12} color={theme.colors.textSecondary} />
            <Text style={styles.location} numberOfLines={1}>{event.location}</Text>
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
    backgroundColor: theme.colors.surface,
  },
  timeBar: {
    width: 3,
    height: 36,
    borderRadius: 1.5,
    backgroundColor: theme.colors.todayBlue,
    marginRight: 10,
  },
  timeContainer: {
    width: 60,
    marginRight: 8,
  },
  time: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.todayBlue,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '400',
    color: theme.colors.text,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  location: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginLeft: 4,
  },
});
