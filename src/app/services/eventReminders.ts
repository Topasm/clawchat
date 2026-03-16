import { IS_CAPACITOR } from '../types/platform';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { EventResponse } from '../types/api';

const REMINDER_ID_BASE = 100000;
const MAX_SCHEDULED = 20;
const DEFAULT_REMINDER_MINUTES = 10;

function eventIdToNotificationId(eventId: string): number {
  let hash = 0;
  for (let i = 0; i < eventId.length; i++) {
    hash = ((hash << 5) - hash + eventId.charCodeAt(i)) | 0;
  }
  return REMINDER_ID_BASE + (Math.abs(hash) % 100000);
}

let previouslyScheduledIds: number[] = [];

export async function scheduleEventReminders(events: EventResponse[]): Promise<void> {
  if (!IS_CAPACITOR) return;
  if (!useSettingsStore.getState().notificationsEnabled) return;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    // Cancel previously scheduled reminders
    if (previouslyScheduledIds.length > 0) {
      await LocalNotifications.cancel({
        notifications: previouslyScheduledIds.map((id) => ({ id })),
      });
      previouslyScheduledIds = [];
    }

    const now = Date.now();

    const toSchedule = events
      .map((event) => {
        const startTime = new Date(event.start_time).getTime();
        const reminderMinutes = event.reminder_minutes ?? DEFAULT_REMINDER_MINUTES;
        const fireAt = startTime - reminderMinutes * 60_000;
        return { event, fireAt, reminderMinutes };
      })
      .filter(({ fireAt }) => fireAt > now)
      .sort((a, b) => a.fireAt - b.fireAt)
      .slice(0, MAX_SCHEDULED);

    if (toSchedule.length === 0) return;

    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'prompt') {
      const result = await LocalNotifications.requestPermissions();
      if (result.display !== 'granted') return;
    } else if (perm.display !== 'granted') {
      return;
    }

    const notifications = toSchedule.map(({ event, fireAt, reminderMinutes }) => ({
      id: eventIdToNotificationId(event.id),
      title: event.title,
      body: `Starting in ${reminderMinutes} minute${reminderMinutes === 1 ? '' : 's'}`,
      schedule: { at: new Date(fireAt) },
      smallIcon: 'ic_stat_clawchat',
      extra: { eventId: event.id },
    }));

    await LocalNotifications.schedule({ notifications });
    previouslyScheduledIds = notifications.map((n) => n.id);
  } catch {
    // Reminder scheduling is best-effort
  }
}
