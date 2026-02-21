import React, { useEffect, useCallback, useState } from 'react';
import { View, SectionList, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../config/ThemeContext';
import { useModuleStore } from '../stores/useModuleStore';
import TaskRow from '../components/TaskRow';
import SectionHeader from '../components/SectionHeader';
import EmptyState from '../components/EmptyState';

export default function AllTasksScreen({ navigation }) {
  const { colors } = useTheme();

  const todos = useModuleStore((s) => s.todos);
  const fetchTodos = useModuleStore((s) => s.fetchTodos);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    await fetchTodos();
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

  const inProgress = todos.filter((t) => t.status === 'in_progress');
  const pending = todos.filter((t) => t.status === 'pending');
  const completed = todos.filter(
    (t) => t.status === 'completed' && t.completed_at &&
      new Date(t.completed_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );

  const sections = [
    ...(inProgress.length ? [{ title: 'In Progress', data: inProgress, count: inProgress.length }] : []),
    ...(pending.length ? [{ title: 'Pending', data: pending, count: pending.length }] : []),
    ...(completed.length ? [{ title: 'Completed (Last 7 days)', data: completed, count: completed.length }] : []),
  ];

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
    />
  );

  const renderSectionHeader = ({ section }) => (
    <SectionHeader title={section.title} count={section.count} />
  );

  if (sections.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="clipboard-outline"
          title="No Tasks"
          subtitle="Create tasks using the + button or chat."
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
        )}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  separator: {
    height: 1,
    marginLeft: 52,
  },
});
