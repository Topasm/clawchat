import { IS_CAPACITOR, IS_ANDROID } from '../types/platform';
import { syncWidgetData } from './widgetSync';
import { scheduleEventReminders } from './eventReminders';
import { useModuleStore } from '../stores/useModuleStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import apiClient from './apiClient';

function getTodayEvents() {
  const { events } = useModuleStore.getState();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  return events.filter((e) => {
    const d = new Date(e.start_time);
    return d >= todayStart && d < todayEnd;
  });
}

export async function initCapacitor(): Promise<void> {
  if (!IS_CAPACITOR) return;

  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Dark });
  if (IS_ANDROID) await StatusBar.setBackgroundColor({ color: '#0f0f0f' });

  // Request notification permissions early
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display === 'prompt') {
    await LocalNotifications.requestPermissions();
  }

  // Register action types for "Mark Done" button on reminder notifications
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: 'REMINDER_ACTIONS',
        actions: [
          {
            id: 'mark_done',
            title: 'Mark Done',
          },
          {
            id: 'open',
            title: 'Open',
          },
        ],
      },
    ],
  });

  // Handle notification actions (tap or "Mark Done" button)
  LocalNotifications.addListener('localNotificationActionPerformed', async (action) => {
    const extra = action.notification?.extra;
    const actionId = action.actionId;

    // Handle "Mark Done" action from reminder notification
    if (actionId === 'mark_done' && extra?.itemId) {
      try {
        if (extra.itemType === 'todo') {
          await apiClient.patch(`/todos/${extra.itemId}`, { status: 'completed' });
        }
        // Trigger data refresh
        window.dispatchEvent(new CustomEvent('app:resume'));
      } catch {
        // Best-effort — user can open the app to complete the action
      }
      return;
    }

    // Default tap action: navigate to the item
    const eventId = extra?.eventId;
    const itemId = extra?.itemId;
    const itemType = extra?.itemType;
    if (eventId) {
      window.dispatchEvent(new CustomEvent('navigate', { detail: `/events/${eventId}` }));
    } else if (itemId && itemType) {
      const route = itemType === 'todo' ? `/tasks/${itemId}` : `/events/${itemId}`;
      window.dispatchEvent(new CustomEvent('navigate', { detail: route }));
    }
  });

  const { App } = await import('@capacitor/app');
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else App.exitApp();
  });
  let lastBackgrounded = 0;
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      window.dispatchEvent(new CustomEvent('app:resume'));
      syncWidgetData();
      scheduleEventReminders(getTodayEvents());

      // Biometric lock check after 5+ min in background
      const elapsed = Date.now() - lastBackgrounded;
      if (lastBackgrounded > 0 && elapsed > 5 * 60 * 1000) {
        const biometricEnabled = useSettingsStore.getState().biometricEnabled;
        if (biometricEnabled) {
          import('@capacitor/core').then(({ Capacitor }) => {
            const Biometric = Capacitor.Plugins['Biometric'] as {
              authenticate(opts: { title: string; subtitle: string }): Promise<{ success: boolean }>;
            } | undefined;
            if (!Biometric) return;
            Biometric.authenticate({
              title: 'Unlock ClawChat',
              subtitle: 'Verify your identity to continue',
            }).then((result) => {
              if (!result.success) {
                window.dispatchEvent(new CustomEvent('navigate', { detail: '/login' }));
              }
            }).catch(() => {
              window.dispatchEvent(new CustomEvent('navigate', { detail: '/login' }));
            });
          });
        }
      }
    } else {
      lastBackgrounded = Date.now();
    }
  });

  // Listen for widget deep-link navigation
  window.addEventListener('widget:navigate', ((e: CustomEvent<string>) => {
    const route = e.detail;
    if (route) {
      window.dispatchEvent(new CustomEvent('navigate', { detail: route }));
    }
  }) as EventListener);

  // Handle clawchat:// deep links from native side
  window.addEventListener('deeplink:navigate', ((e: CustomEvent<string>) => {
    const route = e.detail;
    if (route) {
      window.dispatchEvent(new CustomEvent('navigate', { detail: route }));
    }
  }) as EventListener);

  // Handle deep links via Capacitor App plugin (covers iOS + late Android intents)
  App.addListener('appUrlOpen', ({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'clawchat:') {
        const route = '/' + parsed.hostname + (parsed.pathname === '/' ? '' : parsed.pathname);
        window.dispatchEvent(new CustomEvent('navigate', { detail: route }));
      }
    } catch {
      // Malformed URL — ignore
    }
  });
}
