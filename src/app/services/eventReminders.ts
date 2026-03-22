import { IS_CAPACITOR, IS_ANDROID } from '../types/platform';
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

/**
 * On Android: uses the native AlarmScheduler plugin (AlarmManager) for reliable
 * delivery even when the app is killed or device reboots.
 * On iOS/other: falls back to Capacitor LocalNotifications.
 */
export async function scheduleEventReminders(events: EventResponse[]): Promise<void> {
  if (!IS_CAPACITOR) return;
  if (!useSettingsStore.getState().notificationsEnabled) return;

  try {
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

    if (IS_ANDROID) {
      await scheduleViaAlarmManager(toSchedule);
    } else {
      await scheduleViaLocalNotifications(toSchedule);
    }
  } catch {
    // Reminder scheduling is best-effort
  }
}

interface ScheduleEntry {
  event: EventResponse;
  fireAt: number;
  reminderMinutes: number;
}

async function scheduleViaAlarmManager(toSchedule: ScheduleEntry[]): Promise<void> {
  const { Capacitor } = await import('@capacitor/core');
  const AlarmScheduler = Capacitor.Plugins['AlarmScheduler'] as {
    scheduleReminder(opts: {
      id: number;
      title: string;
      body: string;
      triggerAt: number;
      type: string;
      itemId: string;
      route: string;
    }): Promise<void>;
    cancelReminder(opts: { id: number }): Promise<void>;
  } | undefined;

  if (!AlarmScheduler) return;

  // Cancel previously scheduled reminders
  for (const id of previouslyScheduledIds) {
    await AlarmScheduler.cancelReminder({ id });
  }
  previouslyScheduledIds = [];

  for (const { event, fireAt, reminderMinutes } of toSchedule) {
    const id = eventIdToNotificationId(event.id);
    await AlarmScheduler.scheduleReminder({
      id,
      title: event.title,
      body: `Starting in ${reminderMinutes} minute${reminderMinutes === 1 ? '' : 's'}`,
      triggerAt: fireAt,
      type: 'event',
      itemId: event.id,
      route: `/events/${event.id}`,
    });
    previouslyScheduledIds.push(id);
  }
}

async function scheduleViaLocalNotifications(toSchedule: ScheduleEntry[]): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');

  // Cancel previously scheduled reminders
  if (previouslyScheduledIds.length > 0) {
    await LocalNotifications.cancel({
      notifications: previouslyScheduledIds.map((id) => ({ id })),
    });
    previouslyScheduledIds = [];
  }

  const perm = await LocalNotifications.checkPermissions();
  if (perm.display === 'prompt') {
    const result = await LocalNotifications.requestPermissions();
    if (result.display !== 'granted') return;
  } else if (perm.display !== 'granted') {
    return;
  }

  const soundEnabled = useSettingsStore.getState().reminderSound;
  const notifications = toSchedule.map(({ event, fireAt, reminderMinutes }) => ({
    id: eventIdToNotificationId(event.id),
    title: event.title,
    body: `Starting in ${reminderMinutes} minute${reminderMinutes === 1 ? '' : 's'}`,
    schedule: { at: new Date(fireAt) },
    smallIcon: 'ic_stat_clawchat',
    sound: soundEnabled ? undefined : '', // empty string = silent
    extra: { eventId: event.id },
  }));

  await LocalNotifications.schedule({ notifications });
  previouslyScheduledIds = notifications.map((n) => n.id);
}
