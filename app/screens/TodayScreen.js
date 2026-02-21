import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../config/ThemeContext';
import { useModuleStore } from '../stores/useModuleStore';
import useTodayData from '../hooks/useTodayData';
import TaskRow from '../components/TaskRow';
import EventRow from '../components/EventRow';
import SectionHeader from '../components/SectionHeader';
import EmptyState from '../components/EmptyState';

export default function TodayScreen({ navigation }) {
  const { colors } = useTheme();

  const {
    todayTasks,
    overdueTasks,
    todayEvents,
    inboxCount,
    greeting,
    todayDate,
    isLoading,
    refresh,
  } = useTodayData();

  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);

  const handleTaskPress = (todo) => {
    navigation.navigate('TaskDetail', { todoId: todo.id });
  };

  const handleEventPress = (event) => {
    navigation.navigate('EventDetail', { eventId: event.id });
  };

  const handleToggleComplete = (todo) => {
    toggleTodoComplete(todo.id);
  };

  const dateString = todayDate
    ? new Date(todayDate + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : '';

  const totalTodayCount = todayTasks.length + overdueTasks.length;
  const hasContent = todayTasks.length > 0 || overdueTasks.length > 0 || todayEvents.length > 0;

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
    >
      {/* Greeting Header */}
      <View style={[styles.greetingHeader, { backgroundColor: colors.surface }]}>
        <Text style={[styles.greeting, { color: colors.text }]}>{greeting}</Text>
        <Text style={[styles.date, { color: colors.textSecondary }]}>{dateString}</Text>
        {totalTodayCount > 0 && (
          <Text style={[styles.summary, { color: colors.todayBlue }]}>
            {totalTodayCount} task{totalTodayCount !== 1 ? 's' : ''} for today
          </Text>
        )}
      </View>

      {!hasContent && (
        <EmptyState
          icon="sunny-outline"
          title="All clear!"
          subtitle="No tasks or events for today. Enjoy your day!"
          actionLabel="Add Task"
          onAction={() => navigation.navigate('QuickCapture')}
        />
      )}

      {/* Events Section */}
      {todayEvents.length > 0 && (
        <View>
          <SectionHeader title="Events" count={todayEvents.length} />
          {todayEvents.map((event) => (
            <EventRow key={event.id} event={event} onPress={handleEventPress} />
          ))}
        </View>
      )}

      {/* Overdue Section */}
      {overdueTasks.length > 0 && (
        <View>
          <SectionHeader
            title="Overdue"
            count={overdueTasks.length}
          />
          {overdueTasks.map((todo) => (
            <TaskRow
              key={todo.id}
              todo={todo}
              onToggleComplete={handleToggleComplete}
              onPress={handleTaskPress}
            />
          ))}
        </View>
      )}

      {/* Today Tasks Section */}
      {todayTasks.length > 0 && (
        <View>
          <SectionHeader
            title="Tasks"
            count={todayTasks.length}
            rightAction={{ label: 'See All', onPress: () => navigation.navigate('AllTasks') }}
          />
          {todayTasks.map((todo) => (
            <TaskRow
              key={todo.id}
              todo={todo}
              onToggleComplete={handleToggleComplete}
              onPress={handleTaskPress}
            />
          ))}
        </View>
      )}

      {/* Inbox indicator */}
      {inboxCount > 0 && (
        <View
          style={[
            styles.inboxBanner,
            {
              backgroundColor: colors.surface,
              borderLeftColor: colors.inboxYellow,
            },
          ]}
        >
          <Text style={[styles.inboxText, { color: colors.textSecondary }]}>
            {inboxCount} item{inboxCount !== 1 ? 's' : ''} in Inbox
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  greetingHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '700',
  },
  date: {
    fontSize: 15,
    marginTop: 4,
  },
  summary: {
    fontSize: 14,
    marginTop: 8,
    fontWeight: '500',
  },
  inboxBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  inboxText: {
    fontSize: 14,
  },
});
