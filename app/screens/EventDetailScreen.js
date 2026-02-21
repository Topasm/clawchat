import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../config/ThemeContext';
import apiClient from '../services/apiClient';
import { useModuleStore } from '../stores/useModuleStore';
import { formatDate, formatTime } from '../utils/formatters';

export default function EventDetailScreen({ route, navigation }) {
  const { colors } = useTheme();

  const { eventId } = route.params;
  const updateStoreEvent = useModuleStore((s) => s.updateEvent);
  const removeEvent = useModuleStore((s) => s.removeEvent);

  const [event, setEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const debounceRef = useRef(null);

  const fetchEvent = useCallback(async () => {
    try {
      const response = await apiClient.get(`/events/${eventId}`);
      setEvent(response.data);
      setTitle(response.data.title);
      setDescription(response.data.description || '');
      setLocation(response.data.location || '');
    } catch {
      Alert.alert('Error', 'Failed to load event.');
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  }, [eventId, navigation]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const patchEvent = useCallback(
    async (updates) => {
      try {
        const response = await apiClient.patch(`/events/${eventId}`, updates);
        setEvent(response.data);
        updateStoreEvent(eventId, response.data);
      } catch {
        Alert.alert('Error', 'Failed to update event.');
      }
    },
    [eventId, updateStoreEvent]
  );

  const debouncedPatch = useCallback(
    (updates) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => patchEvent(updates), 500);
    },
    [patchEvent]
  );

  const handleTitleChange = (text) => {
    setTitle(text);
    debouncedPatch({ title: text });
  };

  const handleDescriptionChange = (text) => {
    setDescription(text);
    debouncedPatch({ description: text });
  };

  const handleLocationChange = (text) => {
    setLocation(text);
    debouncedPatch({ location: text });
  };

  const toggleAllDay = () => {
    if (!event) return;
    const newVal = !event.is_all_day;
    setEvent({ ...event, is_all_day: newVal });
    patchEvent({ is_all_day: newVal });
  };

  const handleDelete = () => {
    Alert.alert('Delete Event', 'Are you sure you want to delete this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/events/${eventId}`);
            removeEvent(eventId);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Failed to delete event.');
          }
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!event) return null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surface }]}
      contentContainerStyle={styles.content}
    >
      <TextInput
        style={[styles.titleInput, { color: colors.text }]}
        value={title}
        onChangeText={handleTitleChange}
        placeholder="Event title"
        placeholderTextColor={colors.disabled}
      />

      <View style={[styles.cell, { borderBottomColor: colors.border }]}>
        <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.cellLabel, { color: colors.text }]}>Start</Text>
        <Text style={[styles.cellValue, { color: colors.textSecondary }]}>
          {formatDate(event.start_time)} {!event.is_all_day && formatTime(event.start_time)}
        </Text>
      </View>

      {event.end_time && (
        <View style={[styles.cell, { borderBottomColor: colors.border }]}>
          <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.cellLabel, { color: colors.text }]}>End</Text>
          <Text style={[styles.cellValue, { color: colors.textSecondary }]}>
            {formatDate(event.end_time)} {!event.is_all_day && formatTime(event.end_time)}
          </Text>
        </View>
      )}

      <View style={[styles.cell, { borderBottomColor: colors.border }]}>
        <Ionicons name="sunny-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.cellLabel, { color: colors.text }]}>All Day</Text>
        <Switch
          value={event.is_all_day}
          onValueChange={toggleAllDay}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={[styles.cell, { borderBottomColor: colors.border }]}>
        <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.cellLabel, { color: colors.text }]}>Location</Text>
        <TextInput
          style={[styles.cellInput, { color: colors.text }]}
          value={location}
          onChangeText={handleLocationChange}
          placeholder="Add location"
          placeholderTextColor={colors.disabled}
        />
      </View>

      {event.reminder_minutes != null && (
        <View style={[styles.cell, { borderBottomColor: colors.border }]}>
          <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.cellLabel, { color: colors.text }]}>Reminder</Text>
          <Text style={[styles.cellValue, { color: colors.textSecondary }]}>
            {event.reminder_minutes} min before
          </Text>
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Description</Text>
      <TextInput
        style={[
          styles.descriptionInput,
          { color: colors.text, backgroundColor: colors.background },
        ]}
        value={description}
        onChangeText={handleDescriptionChange}
        placeholder="Add a description..."
        placeholderTextColor={colors.disabled}
        multiline
        textAlignVertical="top"
      />

      <TouchableOpacity
        style={[styles.deleteButton, { backgroundColor: colors.deleteBackground }]}
        onPress={handleDelete}
      >
        <Ionicons name="trash-outline" size={18} color={colors.error} />
        <Text style={[styles.deleteText, { color: colors.error }]}>Delete Event</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleInput: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 24,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  cellLabel: {
    flex: 1,
    fontSize: 16,
    marginLeft: 12,
  },
  cellValue: {
    fontSize: 16,
  },
  cellInput: {
    fontSize: 16,
    textAlign: 'right',
    flex: 0,
    minWidth: 120,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
  },
  descriptionInput: {
    fontSize: 16,
    minHeight: 100,
    padding: 12,
    borderRadius: 8,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
