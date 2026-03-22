import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { TodayResponseSchema, TodoResponseSchema, EventResponseSchema } from '../../types/schemas';
import { getGreeting } from '../../utils/formatters';
import type { TodoResponse, EventResponse } from '../../types/api';
import { queryKeys } from './queryKeys';
import { syncWidgetData } from '../../services/widgetSync';
import { scheduleEventReminders } from '../../services/eventReminders';

interface TodayData {
  todayTasks: TodoResponse[];
  overdueTasks: TodoResponse[];
  todayEvents: EventResponse[];
  inboxCount: number;
  greeting: string;
  todayDate: string;
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Derive today-page data from the TanStack Query cache (used in demo mode
 * and as a fallback when the server is unreachable).
 */
function deriveTodayFromCache(
  todos: TodoResponse[],
  events: EventResponse[],
): Omit<TodayData, 'isLoading' | 'refresh'> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const todayTasks = todos.filter((t) => {
    if (!t.due_date) return false;
    const d = new Date(t.due_date);
    return d >= todayStart && d < todayEnd && t.status !== 'completed';
  });

  const overdueTasks = todos.filter((t) => {
    if (!t.due_date) return false;
    return new Date(t.due_date) < todayStart && t.status !== 'completed';
  });

  const todayEvents = events.filter((e) => {
    const d = new Date(e.start_time);
    return d >= todayStart && d < todayEnd;
  });

  const inboxCount = todos.filter((t) => !t.due_date && t.status === 'pending').length;

  return {
    todayTasks,
    overdueTasks,
    todayEvents,
    inboxCount,
    greeting: getGreeting(),
    todayDate: now.toISOString().split('T')[0],
  };
}

interface TodayQueryResult {
  todayTasks: TodoResponse[];
  overdueTasks: TodoResponse[];
  todayEvents: EventResponse[];
  inboxCount: number;
  greeting: string;
  todayDate: string;
}

export default function useTodayData(): TodayData {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const queryClient = useQueryClient();

  const query = useQuery<TodayQueryResult>({
    queryKey: queryKeys.today,
    queryFn: async () => {
      try {
        const res = await apiClient.get('/today');
        const data = TodayResponseSchema.parse(res.data);
        return {
          todayTasks: data.today_tasks,
          overdueTasks: data.overdue_tasks,
          todayEvents: data.today_events,
          inboxCount: data.inbox_count,
          greeting: data.greeting,
          todayDate: data.date,
        };
      } catch {
        // Fallback: parallel fetch of todos + events
        const [todosRes, eventsRes] = await Promise.all([
          apiClient.get('/todos'),
          apiClient.get('/events'),
        ]);
        const todos = z.array(TodoResponseSchema).parse(todosRes.data?.items ?? todosRes.data ?? []);
        const events = z.array(EventResponseSchema).parse(eventsRes.data?.items ?? eventsRes.data ?? []);

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);

        return {
          todayTasks: todos.filter((t) => {
            if (!t.due_date) return false;
            const d = new Date(t.due_date);
            return d >= todayStart && d < todayEnd && t.status !== 'completed';
          }),
          overdueTasks: todos.filter((t) => {
            if (!t.due_date) return false;
            return new Date(t.due_date) < todayStart && t.status !== 'completed';
          }),
          todayEvents: events.filter((e) => {
            const d = new Date(e.start_time);
            return d >= todayStart && d < todayEnd;
          }),
          inboxCount: todos.filter((t) => !t.due_date && t.status === 'pending').length,
          greeting: getGreeting(),
          todayDate: now.toISOString().split('T')[0],
        };
      }
    },
    enabled: !!serverUrl,
    refetchOnWindowFocus: true,
  });

  // Side effects: sync widget data and schedule event reminders
  // These run in a useEffect that depends on query.data rather than during render
  useEffect(() => {
    if (query.data) {
      syncWidgetData();
      scheduleEventReminders(query.data.todayEvents);
    }
  }, [query.data]);

  // In demo mode (no serverUrl), derive from cache
  if (!serverUrl) {
    const cachedTodos = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos) ?? [];
    const cachedEvents = queryClient.getQueryData<EventResponse[]>(queryKeys.events) ?? [];
    const derived = deriveTodayFromCache(cachedTodos, cachedEvents);
    return {
      ...derived,
      isLoading: false,
      refresh: () => {},
    };
  }

  // Server mode: use query data or fallback to cache-derived data
  const data = query.data;
  if (data) {
    return {
      ...data,
      isLoading: query.isLoading,
      refresh: () => { query.refetch(); },
    };
  }

  // While loading or on error, use cache-derived fallback
  const cachedTodos = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos) ?? [];
  const cachedEvents = queryClient.getQueryData<EventResponse[]>(queryKeys.events) ?? [];
  const fallback = deriveTodayFromCache(cachedTodos, cachedEvents);
  return {
    ...fallback,
    isLoading: query.isLoading,
    refresh: () => { query.refetch(); },
  };
}
