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
import { useTheme } from '../config/ThemeContext';
import apiClient from '../services/apiClient';
import { useModuleStore } from '../stores/useModuleStore';
import PriorityBadge from '../components/PriorityBadge';
import { formatDate, formatTime } from '../utils/formatters';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

export default function TaskDetailScreen({ route, navigation }) {
  const { colors } = useTheme();

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
      <View style={[styles.loadingContainer, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!todo) return null;

  const isCompleted = todo.status === 'completed';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surface }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.titleRow}>
        <TouchableOpacity
          style={[
            styles.checkbox,
            { borderColor: colors.border },
            isCompleted && {
              backgroundColor: colors.completedGreen,
              borderColor: colors.completedGreen,
            },
          ]}
          onPress={toggleComplete}
        >
          {isCompleted && <Ionicons name="checkmark" size={18} color="#FFF" />}
        </TouchableOpacity>
        <TextInput
          style={[
            styles.titleInput,
            { color: colors.text },
            isCompleted && { textDecorationLine: 'line-through', color: colors.textSecondary },
          ]}
          value={title}
          onChangeText={handleTitleChange}
          placeholder="Task title"
          placeholderTextColor={colors.disabled}
        />
      </View>

      <TouchableOpacity
        style={[styles.cell, { borderBottomColor: colors.border }]}
        onPress={cyclePriority}
      >
        <Ionicons name="flag-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.cellLabel, { color: colors.text }]}>Priority</Text>
        <View style={styles.cellRight}>
          <Text style={[styles.cellValue, { color: colors.textSecondary }]}>
            {PRIORITY_LABELS[todo.priority]}
          </Text>
          <PriorityBadge priority={todo.priority} size={10} />
        </View>
      </TouchableOpacity>

      <View style={[styles.cell, { borderBottomColor: colors.border }]}>
        <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.cellLabel, { color: colors.text }]}>Due Date</Text>
        <Text style={[styles.cellValue, { color: colors.textSecondary }]}>
          {todo.due_date ? formatDate(todo.due_date) : 'None'}
        </Text>
      </View>

      {todo.tags && todo.tags.length > 0 && (
        <View style={[styles.cell, { borderBottomColor: colors.border }]}>
          <Ionicons name="pricetag-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.cellLabel, { color: colors.text }]}>Tags</Text>
          <Text style={[styles.cellValue, { color: colors.textSecondary }]}>
            {todo.tags.join(', ')}
          </Text>
        </View>
      )}

      <View style={[styles.cell, { borderBottomColor: colors.border }]}>
        <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.cellLabel, { color: colors.text }]}>Status</Text>
        <Text style={[styles.cellValue, { color: colors.textSecondary }]}>{todo.status}</Text>
      </View>

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

      {todo.conversation_id && (
        <TouchableOpacity style={styles.chatLink}>
          <Ionicons name="chatbubble-outline" size={16} color={colors.primary} />
          <Text style={[styles.chatLinkText, { color: colors.primary }]}>Created from chat</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.deleteButton, { backgroundColor: colors.deleteBackground }]}
        onPress={handleDelete}
      >
        <Ionicons name="trash-outline" size={18} color={colors.error} />
        <Text style={[styles.deleteText, { color: colors.error }]}>Delete Task</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  titleInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '600',
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
  cellRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cellValue: {
    fontSize: 16,
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
  chatLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 6,
  },
  chatLinkText: {
    fontSize: 14,
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
