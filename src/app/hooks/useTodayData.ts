import { useState, useCallback, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import { useModuleStore } from '../stores/useModuleStore';
import type { TodoResponse, EventResponse } from '../types/api';

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

/** Generate a greeting based on hour of day */
function greetingForHour(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Derive today-page data from the Zustand store (used in demo mode and as
 * a fallback when the server is unreachable).
 */
function deriveTodayFromStore(): Omit<TodayData, 'isLoading' | 'refresh'> {
  const { todos, events } = useModuleStore.getState();
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
    greeting: greetingForHour(),
    todayDate: now.toISOString().split('T')[0],
  };
}

export default function useTodayData(): TodayData {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  // Subscribe to store changes so demo mode stays reactive
  const storeTodos = useModuleStore((s) => s.todos);
  const storeEvents = useModuleStore((s) => s.events);

  const demoFallback = deriveTodayFromStore();

  const [todayTasks, setTodayTasks] = useState<TodoResponse[]>(demoFallback.todayTasks);
  const [overdueTasks, setOverdueTasks] = useState<TodoResponse[]>(demoFallback.overdueTasks);
  const [todayEvents, setTodayEvents] = useState<EventResponse[]>(demoFallback.todayEvents);
  const [inboxCount, setInboxCount] = useState(demoFallback.inboxCount);
  const [greeting, setGreeting] = useState(demoFallback.greeting);
  const [todayDate, setTodayDate] = useState(demoFallback.todayDate);
  const [isLoading, setIsLoading] = useState(false);

  // In demo mode, derive data from the store whenever todos/events change
  useEffect(() => {
    if (serverUrl) return; // server mode handles its own state
    const derived = deriveTodayFromStore();
    setTodayTasks(derived.todayTasks);
    setOverdueTasks(derived.overdueTasks);
    setTodayEvents(derived.todayEvents);
    setInboxCount(derived.inboxCount);
    setGreeting(derived.greeting);
    setTodayDate(derived.todayDate);
  }, [serverUrl, storeTodos, storeEvents]);

  const fetchData = useCallback(async () => {
    if (!serverUrl) return; // demo mode — no fetch needed
    setIsLoading(true);
    try {
      const response = await apiClient.get('/today');
      const data = response.data;
      setTodayTasks(data.today_tasks || []);
      setOverdueTasks(data.overdue_tasks || []);
      setTodayEvents(data.today_events || []);
      setInboxCount(data.inbox_count || 0);
      setGreeting(data.greeting || '');
      setTodayDate(data.date || '');
    } catch {
      // Fallback: parallel fetch
      try {
        const [todosRes, eventsRes] = await Promise.all([
          apiClient.get('/todos', { params: { status: 'pending' } }),
          apiClient.get('/events'),
        ]);
        const allTodos: TodoResponse[] = todosRes.data?.items ?? todosRes.data ?? [];
        const allEvents: EventResponse[] = eventsRes.data?.items ?? eventsRes.data ?? [];

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);

        setTodayTasks(
          allTodos.filter((t) => {
            if (!t.due_date) return false;
            const d = new Date(t.due_date);
            return d >= todayStart && d < todayEnd && t.status !== 'completed';
          }),
        );
        setOverdueTasks(
          allTodos.filter((t) => {
            if (!t.due_date) return false;
            return new Date(t.due_date) < todayStart && t.status !== 'completed';
          }),
        );
        setTodayEvents(
          allEvents.filter((e) => {
            const d = new Date(e.start_time);
            return d >= todayStart && d < todayEnd;
          }),
        );
        setInboxCount(allTodos.filter((t) => !t.due_date && t.status === 'pending').length);

        setGreeting(greetingForHour());
        setTodayDate(now.toISOString().split('T')[0]);
      } catch {
        // Both failed — fall back to store data
        const derived = deriveTodayFromStore();
        setTodayTasks(derived.todayTasks);
        setOverdueTasks(derived.overdueTasks);
        setTodayEvents(derived.todayEvents);
        setInboxCount(derived.inboxCount);
        setGreeting(derived.greeting);
        setTodayDate(derived.todayDate);
      }
    } finally {
      setIsLoading(false);
    }
  }, [serverUrl]);

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Fetch on mount + re-fetch when window regains focus (replaces useFocusEffect)
  useEffect(() => {
    if (!serverUrl) return; // demo mode doesn't need fetch
    fetchData();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData, serverUrl]);

  return { todayTasks, overdueTasks, todayEvents, inboxCount, greeting, todayDate, isLoading, refresh };
}
