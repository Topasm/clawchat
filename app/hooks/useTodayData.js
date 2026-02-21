import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../services/apiClient';

export default function useTodayData() {
  const [todayTasks, setTodayTasks] = useState([]);
  const [overdueTasks, setOverdueTasks] = useState([]);
  const [todayEvents, setTodayEvents] = useState([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [greeting, setGreeting] = useState('');
  const [todayDate, setTodayDate] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Try the consolidated endpoint first
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
        const allTodos = todosRes.data.items || [];
        const allEvents = eventsRes.data.items || [];

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);

        setTodayTasks(
          allTodos.filter((t) => {
            if (!t.due_date) return false;
            const d = new Date(t.due_date);
            return d >= todayStart && d < todayEnd && t.status !== 'completed';
          })
        );
        setOverdueTasks(
          allTodos.filter((t) => {
            if (!t.due_date) return false;
            return new Date(t.due_date) < todayStart && t.status !== 'completed';
          })
        );
        setTodayEvents(
          allEvents.filter((e) => {
            const d = new Date(e.start_time);
            return d >= todayStart && d < todayEnd;
          })
        );
        setInboxCount(allTodos.filter((t) => !t.due_date && t.status === 'pending').length);

        const hour = now.getHours();
        setGreeting(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
        setTodayDate(now.toISOString().split('T')[0]);
      } catch {
        // Both failed, set empty
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => fetchData(), [fetchData]);

  // Re-fetch on screen focus
  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  return { todayTasks, overdueTasks, todayEvents, inboxCount, greeting, todayDate, isLoading, refresh };
}
