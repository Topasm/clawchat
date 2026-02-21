import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE_KEY = 'auth-storage';

async function getAuthData() {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.state || parsed;
  } catch {
    return null;
  }
}

function formatTime(dateString) {
  const d = new Date(dateString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export async function widgetTaskHandler(widgetInfo) {
  const auth = await getAuthData();

  if (!auth?.token || !auth?.serverUrl) {
    return {
      greeting: 'ClawChat',
      taskCount: 0,
      tasks: [],
      nextEvent: null,
    };
  }

  try {
    const response = await fetch(`${auth.serverUrl}/api/today`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error('API error');

    const data = await response.json();

    const tasks = (data.today_tasks || []).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
    }));

    const events = data.today_events || [];
    const nextEvent = events.length > 0
      ? {
          title: events[0].title,
          time: events[0].is_all_day ? 'All day' : formatTime(events[0].start_time),
        }
      : null;

    return {
      greeting: data.greeting || 'Hello',
      taskCount: tasks.length + (data.overdue_tasks?.length || 0),
      tasks,
      nextEvent,
    };
  } catch {
    return {
      greeting: 'ClawChat',
      taskCount: 0,
      tasks: [],
      nextEvent: null,
    };
  }
}
