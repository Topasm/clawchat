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
import { theme } from '../config/theme';
import apiClient from '../services/apiClient';
import { useModuleStore } from '../stores/useModuleStore';
import { formatDate, formatTime } from '../utils/formatters';

export default function EventDetailScreen({ route, navigation }) {
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!event) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TextInput
        style={styles.titleInput}
        value={title}
        onChangeText={handleTitleChange}
        placeholder="Event title"
        placeholderTextColor={theme.colors.disabled}
      />

      <View style={styles.cell}>
        <Ionicons name="time-outline" size={20} color={theme.colors.textSecondary} />
        <Text style={styles.cellLabel}>Start</Text>
        <Text style={styles.cellValue}>
          {formatDate(event.start_time)} {!event.is_all_day && formatTime(event.start_time)}
        </Text>
      </View>

      {event.end_time && (
        <View style={styles.cell}>
          <Ionicons name="time-outline" size={20} color={theme.colors.textSecondary} />
          <Text style={styles.cellLabel}>End</Text>
          <Text style={styles.cellValue}>
            {formatDate(event.end_time)} {!event.is_all_day && formatTime(event.end_time)}
          </Text>
        </View>
      )}

      <View style={styles.cell}>
        <Ionicons name="sunny-outline" size={20} color={theme.colors.textSecondary} />
        <Text style={styles.cellLabel}>All Day</Text>
        <Switch
          value={event.is_all_day}
          onValueChange={toggleAllDay}
          trackColor={{ true: theme.colors.primary }}
        />
      </View>

      <View style={styles.cell}>
        <Ionicons name="location-outline" size={20} color={theme.colors.textSecondary} />
        <Text style={styles.cellLabel}>Location</Text>
        <TextInput
          style={styles.cellInput}
          value={location}
          onChangeText={handleLocationChange}
          placeholder="Add location"
          placeholderTextColor={theme.colors.disabled}
        />
      </View>

      {event.reminder_minutes != null && (
        <View style={styles.cell}>
          <Ionicons name="notifications-outline" size={20} color={theme.colors.textSecondary} />
          <Text style={styles.cellLabel}>Reminder</Text>
          <Text style={styles.cellValue}>{event.reminder_minutes} min before</Text>
        </View>
      )}

      <Text style={styles.sectionLabel}>Description</Text>
      <TextInput
        style={styles.descriptionInput}
        value={description}
        onChangeText={handleDescriptionChange}
        placeholder="Add a description..."
        placeholderTextColor={theme.colors.disabled}
        multiline
        textAlignVertical="top"
      />

      <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
        <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
        <Text style={styles.deleteText}>Delete Event</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  titleInput: {
    fontSize: 22,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 24,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  cellLabel: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
    marginLeft: 12,
  },
  cellValue: {
    fontSize: 16,
    color: theme.colors.textSecondary,
  },
  cellInput: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: 'right',
    flex: 0,
    minWidth: 120,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: theme.colors.textSecondary,
    marginTop: 24,
    marginBottom: 8,
  },
  descriptionInput: {
    fontSize: 16,
    color: theme.colors.text,
    minHeight: 100,
    padding: 12,
    backgroundColor: theme.colors.background,
    borderRadius: 8,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#FFF0F0',
    gap: 8,
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.error,
  },
});
