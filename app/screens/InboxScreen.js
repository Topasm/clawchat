import React, { useEffect, useCallback, useState } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../config/ThemeContext';
import apiClient from '../services/apiClient';
import { useModuleStore } from '../stores/useModuleStore';
import TaskRow from '../components/TaskRow';
import EmptyState from '../components/EmptyState';

export default function InboxScreen({ navigation }) {
  const { colors } = useTheme();

  const todos = useModuleStore((s) => s.todos);
  const fetchTodos = useModuleStore((s) => s.fetchTodos);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);
  const updateTodo = useModuleStore((s) => s.updateTodo);
  const removeTodo = useModuleStore((s) => s.removeTodo);
  const [refreshing, setRefreshing] = useState(false);

  const inboxTodos = todos.filter((t) => !t.due_date && t.status !== 'completed');

  const loadData = useCallback(async () => {
    await fetchTodos({ status: 'pending' });
  }, [fetchTodos]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSwipeRight = async (todo) => {
    // Set due_date to today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    try {
      await apiClient.patch(`/todos/${todo.id}`, { due_date: today.toISOString() });
      updateTodo(todo.id, { due_date: today.toISOString() });
    } catch {
      Alert.alert('Error', 'Failed to update task.');
    }
  };

  const handleSwipeLeft = async (todo) => {
    Alert.alert('Delete Task', `Delete "${todo.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/todos/${todo.id}`);
            removeTodo(todo.id);
          } catch {
            Alert.alert('Error', 'Failed to delete task.');
          }
        },
      },
    ]);
  };

  const handlePress = (todo) => {
    navigation.navigate('TaskDetail', { todoId: todo.id });
  };

  const handleToggle = (todo) => {
    toggleTodoComplete(todo.id);
  };

  const renderItem = ({ item }) => (
    <TaskRow
      todo={item}
      onToggleComplete={handleToggle}
      onPress={handlePress}
      onSwipeLeft={handleSwipeLeft}
      onSwipeRight={handleSwipeRight}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={inboxTodos}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshing={refreshing}
        onRefresh={onRefresh}
        contentContainerStyle={inboxTodos.length === 0 && styles.emptyContainer}
        ListEmptyComponent={
          <EmptyState
            icon="checkmark-done-outline"
            title="Inbox Zero!"
            subtitle="All caught up. No unscheduled tasks."
          />
        }
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
        )}
      />
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('QuickCapture')}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
  },
  separator: {
    height: 1,
    marginLeft: 52,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
