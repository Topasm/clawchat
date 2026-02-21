import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../config/theme';
import apiClient from '../services/apiClient';
import { useModuleStore } from '../stores/useModuleStore';
import PriorityBadge from '../components/PriorityBadge';
import { formatDate, formatTime } from '../utils/formatters';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

export default function TaskDetailScreen({ route, navigation }) {
  const { todoId } = route.params;
  const updateStoreTodo = useModuleStore((s) => s.updateTodo);
  const removeTodo = useModuleStore((s) => s.removeTodo);

  const [todo, setTodo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const debounceRef = useRef(null);

  const fetchTodo = useCallback(async () => {
    try {
      const response = await apiClient.get(`/todos/${todoId}`);
      setTodo(response.data);
      setTitle(response.data.title);
      setDescription(response.data.description || '');
    } catch {
      Alert.alert('Error', 'Failed to load task.');
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  }, [todoId, navigation]);

  useEffect(() => {
    fetchTodo();
  }, [fetchTodo]);

  const patchTodo = useCallback(
    async (updates) => {
      try {
        const response = await apiClient.patch(`/todos/${todoId}`, updates);
        setTodo(response.data);
        updateStoreTodo(todoId, response.data);
      } catch {
        Alert.alert('Error', 'Failed to update task.');
      }
    },
    [todoId, updateStoreTodo]
  );

  const debouncedPatch = useCallback(
    (updates) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => patchTodo(updates), 500);
    },
    [patchTodo]
  );

  const handleTitleChange = (text) => {
    setTitle(text);
    debouncedPatch({ title: text });
  };

  const handleDescriptionChange = (text) => {
    setDescription(text);
    debouncedPatch({ description: text });
  };

  const cyclePriority = () => {
    if (!todo) return;
    const idx = PRIORITIES.indexOf(todo.priority);
    const next = PRIORITIES[(idx + 1) % PRIORITIES.length];
    setTodo({ ...todo, priority: next });
    patchTodo({ priority: next });
  };

  const toggleComplete = () => {
    if (!todo) return;
    const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
    setTodo({ ...todo, status: newStatus });
    patchTodo({ status: newStatus });
  };

  const handleDelete = () => {
    Alert.alert('Delete Task', 'Are you sure you want to delete this task?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/todos/${todoId}`);
            removeTodo(todoId);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Failed to delete task.');
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

  if (!todo) return null;

  const isCompleted = todo.status === 'completed';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <TouchableOpacity
          style={[styles.checkbox, isCompleted && styles.checkboxCompleted]}
          onPress={toggleComplete}
        >
          {isCompleted && <Ionicons name="checkmark" size={18} color="#FFF" />}
        </TouchableOpacity>
        <TextInput
          style={[styles.titleInput, isCompleted && styles.titleCompleted]}
          value={title}
          onChangeText={handleTitleChange}
          placeholder="Task title"
          placeholderTextColor={theme.colors.disabled}
        />
      </View>

      <TouchableOpacity style={styles.cell} onPress={cyclePriority}>
        <Ionicons name="flag-outline" size={20} color={theme.colors.textSecondary} />
        <Text style={styles.cellLabel}>Priority</Text>
        <View style={styles.cellRight}>
          <Text style={styles.cellValue}>{PRIORITY_LABELS[todo.priority]}</Text>
          <PriorityBadge priority={todo.priority} size={10} />
        </View>
      </TouchableOpacity>

      <View style={styles.cell}>
        <Ionicons name="calendar-outline" size={20} color={theme.colors.textSecondary} />
        <Text style={styles.cellLabel}>Due Date</Text>
        <Text style={styles.cellValue}>
          {todo.due_date ? formatDate(todo.due_date) : 'None'}
        </Text>
      </View>

      {todo.tags && todo.tags.length > 0 && (
        <View style={styles.cell}>
          <Ionicons name="pricetag-outline" size={20} color={theme.colors.textSecondary} />
          <Text style={styles.cellLabel}>Tags</Text>
          <Text style={styles.cellValue}>{todo.tags.join(', ')}</Text>
        </View>
      )}

      <View style={styles.cell}>
        <Ionicons name="information-circle-outline" size={20} color={theme.colors.textSecondary} />
        <Text style={styles.cellLabel}>Status</Text>
        <Text style={styles.cellValue}>{todo.status}</Text>
      </View>

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

      {todo.conversation_id && (
        <TouchableOpacity style={styles.chatLink}>
          <Ionicons name="chatbubble-outline" size={16} color={theme.colors.primary} />
          <Text style={styles.chatLinkText}>Created from chat</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
        <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
        <Text style={styles.deleteText}>Delete Task</Text>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxCompleted: {
    backgroundColor: theme.colors.completedGreen,
    borderColor: theme.colors.completedGreen,
  },
  titleInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '600',
    color: theme.colors.text,
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textSecondary,
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
  cellRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cellValue: {
    fontSize: 16,
    color: theme.colors.textSecondary,
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
  chatLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 6,
  },
  chatLinkText: {
    fontSize: 14,
    color: theme.colors.primary,
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
