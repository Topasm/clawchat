import { useState, useCallback, useEffect } from 'react';
import apiClient from '../services/apiClient';
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

export default function useTodayData(): TodayData {
  const [todayTasks, setTodayTasks] = useState<TodoResponse[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<TodoResponse[]>([]);
  const [todayEvents, setTodayEvents] = useState<EventResponse[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [greeting, setGreeting] = useState('');
  const [todayDate, setTodayDate] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
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
        const allTodos: TodoResponse[] = todosRes.data.items || [];
        const allEvents: EventResponse[] = eventsRes.data.items || [];

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

        const hour = now.getHours();
        setGreeting(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
        setTodayDate(now.toISOString().split('T')[0]);
      } catch {
        // Both failed — seed demo data so the UI isn't empty
        const now = new Date();
        const today = now.toISOString();
        const hour = now.getHours();
        setGreeting(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
        setTodayDate(now.toISOString().split('T')[0]);

        const demoTasks: TodoResponse[] = [
          { id: 'demo-1', title: 'Review ClawChat monorepo structure', status: 'pending', priority: 'high', due_date: today, tags: ['dev'], created_at: today, updated_at: today },
          { id: 'demo-2', title: 'Set up Capacitor for Android build', status: 'pending', priority: 'medium', due_date: today, tags: ['mobile'], created_at: today, updated_at: today },
          { id: 'demo-3', title: 'Write unit tests for platform abstraction', status: 'pending', priority: 'medium', due_date: today, tags: ['testing'], created_at: today, updated_at: today },
          { id: 'demo-4', title: 'Design bottom navigation for mobile layout', status: 'pending', priority: 'low', due_date: today, tags: ['design', 'mobile'], created_at: today, updated_at: today },
        ];

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayISO = yesterday.toISOString();

        const overdueDemo: TodoResponse[] = [
          { id: 'demo-5', title: 'Fix SSE reconnect on network change', status: 'pending', priority: 'urgent', due_date: yesterdayISO, tags: ['bug'], created_at: yesterdayISO, updated_at: yesterdayISO },
          { id: 'demo-6', title: 'Update API documentation for v2 endpoints', status: 'pending', priority: 'high', due_date: yesterdayISO, tags: ['docs'], created_at: yesterdayISO, updated_at: yesterdayISO },
        ];

        const eventStart = new Date(now);
        eventStart.setHours(14, 0, 0, 0);
        const eventEnd = new Date(now);
        eventEnd.setHours(15, 0, 0, 0);

        const demoEvents: EventResponse[] = [
          { id: 'demo-e1', title: 'Sprint planning', start_time: eventStart.toISOString(), end_time: eventEnd.toISOString(), location: 'Zoom', created_at: today, updated_at: today },
          { id: 'demo-e2', title: 'Code review session', start_time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 30).toISOString(), end_time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0).toISOString(), created_at: today, updated_at: today },
        ];

        setTodayTasks(demoTasks);
        setOverdueTasks(overdueDemo);
        setTodayEvents(demoEvents);
        setInboxCount(3);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Fetch on mount + re-fetch when window regains focus (replaces useFocusEffect)
  useEffect(() => {
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
  }, [fetchData]);

  return { todayTasks, overdueTasks, todayEvents, inboxCount, greeting, todayDate, isLoading, refresh };
}
