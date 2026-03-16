import { IS_ANDROID } from '../types/platform';
import { useModuleStore } from '../stores/useModuleStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getGreeting } from '../utils/formatters';

interface WidgetTask {
  title: string;
  priority: string;
}

interface WidgetEvent {
  time: string;
  title: string;
}

interface WidgetData {
  greeting: string;
  date: string;
  tasks: WidgetTask[];
  extraTasks: number;
  events: WidgetEvent[];
}

function formatWidgetTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  if (m === 0) return `${h}:00`;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function buildWidgetData(): WidgetData {
  const { todos, events } = useModuleStore.getState();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Today + overdue tasks, incomplete only
  const allTasks = todos.filter((t) => {
    if (t.status === 'completed') return false;
    if (!t.due_date) return false;
    return new Date(t.due_date) < todayEnd;
  });

  const todayEvents = events
    .filter((e) => {
      const d = new Date(e.start_time);
      return d >= todayStart && d < todayEnd;
    })
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const displayTasks = allTasks.slice(0, 3).map((t) => ({
    title: t.title,
    priority: t.priority ?? '',
  }));

  const displayEvents = todayEvents.slice(0, 2).map((e) => ({
    time: formatWidgetTime(e.start_time),
    title: e.title,
  }));

  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return {
    greeting: getGreeting(),
    date: dateStr,
    tasks: displayTasks,
    extraTasks: Math.max(0, allTasks.length - 3),
    events: displayEvents,
  };
}

export async function syncWidgetData(): Promise<void> {
  if (!IS_ANDROID) return;

  try {
    const { Capacitor } = await import('@capacitor/core');
    const WidgetData = Capacitor.Plugins['WidgetData'] as {
      setWidgetData(opts: { data: string; serverUrl?: string; token?: string }): Promise<void>;
    } | undefined;

    if (!WidgetData) return;

    const data = buildWidgetData();
    const { serverUrl, token } = useAuthStore.getState();
    await WidgetData.setWidgetData({
      data: JSON.stringify(data),
      serverUrl: serverUrl ?? '',
      token: token ?? '',
    });
  } catch {
    // Widget sync is best-effort; don't crash the app
  }
}
