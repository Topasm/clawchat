import { IS_ANDROID } from '../types/platform';
import { queryClient } from '../config/queryClient';
import { useModuleStore } from '../stores/useModuleStore';
import { useAuthStore } from '../stores/useAuthStore';
import { queryKeys } from '../hooks/queries/queryKeys';
import type { TodoResponse, EventResponse } from '../types/api';

function getCachedTodos(): TodoResponse[] {
  return queryClient.getQueryData<TodoResponse[]>(queryKeys.todos) ?? [];
}

function getCachedEvents(): EventResponse[] {
  return queryClient.getQueryData<EventResponse[]>(queryKeys.events) ?? [];
}

interface WidgetTask {
  id: string;
  title: string;
  priority: string;
}

interface WidgetData {
  tasks: WidgetTask[];
  total: number;
}

interface CalendarWidgetData {
  month: string;
  events: { time: string; title: string }[];
  totalEvents: number;
}

interface KanbanWidgetData {
  todoCount: number;
  progressCount: number;
  doneCount: number;
  topTasks: { title: string; priority: string }[];
}

function formatWidgetTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  if (m === 0) return `${h}:00`;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function buildWidgetData(): WidgetData {
  const todos = getCachedTodos();

  // All pending root-level tasks, newest first
  const pendingTasks = todos
    .filter((t) => t.status !== 'completed' && !t.parent_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const displayTasks = pendingTasks.slice(0, 5).map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority ?? '',
  }));

  return {
    tasks: displayTasks,
    total: pendingTasks.length,
  };
}

function buildCalendarWidgetData(): CalendarWidgetData {
  const events = getCachedEvents();
  const now = new Date();
  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Upcoming events from now onwards, sorted by start time
  const upcoming = events
    .filter((e) => new Date(e.start_time).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const displayEvents = upcoming.slice(0, 3).map((e) => ({
    time: formatWidgetTime(e.start_time),
    title: e.title,
  }));

  return {
    month: monthName,
    events: displayEvents,
    totalEvents: upcoming.length,
  };
}

function buildKanbanWidgetData(): KanbanWidgetData {
  const todos = getCachedTodos();
  const store = useModuleStore.getState();

  // Only root-level tasks (no subtasks)
  const rootTasks = todos.filter((t) => !t.parent_id);

  // Use kanban overrides from the store
  const getStatus = (t: { id: string; status: string }) => {
    const kanbanStatus = store.kanbanStatuses[t.id];
    return kanbanStatus ?? t.status;
  };

  const todoCount = rootTasks.filter((t) => getStatus(t) === 'pending').length;
  const progressCount = rootTasks.filter((t) => getStatus(t) === 'in_progress').length;
  const doneCount = rootTasks.filter((t) => getStatus(t) === 'completed').length;

  // Top 3 priority pending tasks (high > medium > low > none)
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const topTasks = rootTasks
    .filter((t) => getStatus(t) !== 'completed')
    .sort((a, b) => {
      const pa = priorityOrder[a.priority ?? ''] ?? 3;
      const pb = priorityOrder[b.priority ?? ''] ?? 3;
      return pa - pb;
    })
    .slice(0, 3)
    .map((t) => ({
      title: t.title,
      priority: t.priority ?? '',
    }));

  return { todoCount, progressCount, doneCount, topTasks };
}

type WidgetPluginType = {
  setWidgetData(opts: { data: string; serverUrl?: string; token?: string }): Promise<void>;
  setCalendarWidgetData?(opts: { data: string }): Promise<void>;
  setKanbanWidgetData?(opts: { data: string }): Promise<void>;
};

export async function syncWidgetData(): Promise<void> {
  if (!IS_ANDROID) return;

  try {
    const { Capacitor } = await import('@capacitor/core');
    const WidgetData = Capacitor.Plugins['WidgetData'] as WidgetPluginType | undefined;

    if (!WidgetData) return;

    const data = buildWidgetData();
    const { serverUrl, token } = useAuthStore.getState();
    await WidgetData.setWidgetData({
      data: JSON.stringify(data),
      serverUrl: serverUrl ?? '',
      token: token ?? '',
    });

    // Sync calendar widget
    if (WidgetData.setCalendarWidgetData) {
      const calendarData = buildCalendarWidgetData();
      await WidgetData.setCalendarWidgetData({ data: JSON.stringify(calendarData) });
    }

    // Sync kanban widget
    if (WidgetData.setKanbanWidgetData) {
      const kanbanData = buildKanbanWidgetData();
      await WidgetData.setKanbanWidgetData({ data: JSON.stringify(kanbanData) });
    }
  } catch {
    // Widget sync is best-effort; don't crash the app
  }
}
