package com.clawchat.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Capacitor plugin that schedules native Android alarms for task/event reminders.
 * Uses AlarmManager.setExactAndAllowWhileIdle() for reliable delivery even when
 * the app is killed. Persists alarm data in SharedPreferences so BootReceiver
 * can reschedule after device reboot.
 */
@CapacitorPlugin(name = "AlarmScheduler")
public class AlarmSchedulerPlugin extends Plugin {

    private static final String TAG = "AlarmSchedulerPlugin";
    private static final String PREFS_NAME = "clawchat_alarms";
    private static final String KEY_ALARMS = "scheduled_alarms";

    @PluginMethod
    public void scheduleReminder(PluginCall call) {
        int id = call.getInt("id", -1);
        String title = call.getString("title", "Reminder");
        String body = call.getString("body", "");
        long triggerAt = call.getLong("triggerAt", 0L);
        String type = call.getString("type", "event"); // "task" or "event"
        String itemId = call.getString("itemId", ""); // original todo/event ID
        String route = call.getString("route", "");

        if (id < 0 || triggerAt <= 0) {
            call.reject("Missing required fields: id and triggerAt");
            return;
        }

        Context context = getContext();
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

        Intent intent = new Intent(context, NotificationReceiver.class);
        intent.setAction("com.clawchat.app.ALARM_FIRED");
        intent.putExtra("notif_id", id);
        intent.putExtra("title", title);
        intent.putExtra("body", body);
        intent.putExtra("type", type);
        intent.putExtra("item_id", itemId);
        intent.putExtra("route", route);

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            triggerAt,
            pendingIntent
        );

        // Persist for boot recovery
        persistAlarm(context, id, title, body, triggerAt, type, itemId, route);

        Log.d(TAG, "Scheduled alarm id=" + id + " type=" + type + " at=" + triggerAt);
        call.resolve();
    }

    @PluginMethod
    public void cancelReminder(PluginCall call) {
        int id = call.getInt("id", -1);
        if (id < 0) {
            call.reject("Missing required field: id");
            return;
        }

        Context context = getContext();
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

        Intent intent = new Intent(context, NotificationReceiver.class);
        intent.setAction("com.clawchat.app.ALARM_FIRED");

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        alarmManager.cancel(pendingIntent);
        removePersistedAlarm(context, id);

        Log.d(TAG, "Cancelled alarm id=" + id);
        call.resolve();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        Context context = getContext();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            alarmManager.cancelAll();
        } else {
            // Cancel each persisted alarm individually
            cancelAllPersisted(context);
        }

        // Clear persisted data
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(KEY_ALARMS).apply();

        Log.d(TAG, "Cancelled all alarms");
        call.resolve();
    }

    // -- Persistence helpers (SharedPreferences JSON array) --

    private void persistAlarm(Context context, int id, String title, String body,
                              long triggerAt, String type, String itemId, String route) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            String existing = prefs.getString(KEY_ALARMS, "[]");
            JSONArray alarms = new JSONArray(existing);

            // Remove existing entry with same ID
            JSONArray filtered = new JSONArray();
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject alarm = alarms.getJSONObject(i);
                if (alarm.getInt("id") != id) {
                    filtered.put(alarm);
                }
            }

            // Add new entry
            JSONObject entry = new JSONObject();
            entry.put("id", id);
            entry.put("title", title);
            entry.put("body", body);
            entry.put("triggerAt", triggerAt);
            entry.put("type", type);
            entry.put("itemId", itemId);
            entry.put("route", route);
            filtered.put(entry);

            prefs.edit().putString(KEY_ALARMS, filtered.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed to persist alarm", e);
        }
    }

    private void removePersistedAlarm(Context context, int id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            String existing = prefs.getString(KEY_ALARMS, "[]");
            JSONArray alarms = new JSONArray(existing);
            JSONArray filtered = new JSONArray();
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject alarm = alarms.getJSONObject(i);
                if (alarm.getInt("id") != id) {
                    filtered.put(alarm);
                }
            }
            prefs.edit().putString(KEY_ALARMS, filtered.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed to remove persisted alarm", e);
        }
    }

    private void cancelAllPersisted(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            String existing = prefs.getString(KEY_ALARMS, "[]");
            JSONArray alarms = new JSONArray(existing);
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject alarm = alarms.getJSONObject(i);
                int alarmId = alarm.getInt("id");

                Intent intent = new Intent(context, NotificationReceiver.class);
                intent.setAction("com.clawchat.app.ALARM_FIRED");
                PendingIntent pi = PendingIntent.getBroadcast(
                    context, alarmId, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                alarmManager.cancel(pi);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to cancel all persisted alarms", e);
        }
    }

    /**
     * Static helper used by BootReceiver to reschedule all persisted alarms.
     */
    static void rescheduleAll(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        try {
            String existing = prefs.getString(KEY_ALARMS, "[]");
            JSONArray alarms = new JSONArray(existing);
            long now = System.currentTimeMillis();

            JSONArray stillValid = new JSONArray();

            for (int i = 0; i < alarms.length(); i++) {
                JSONObject alarm = alarms.getJSONObject(i);
                long triggerAt = alarm.getLong("triggerAt");

                // Skip past alarms
                if (triggerAt <= now) continue;

                int id = alarm.getInt("id");
                String title = alarm.optString("title", "Reminder");
                String body = alarm.optString("body", "");
                String type = alarm.optString("type", "event");
                String itemId = alarm.optString("itemId", "");
                String route = alarm.optString("route", "");

                Intent intent = new Intent(context, NotificationReceiver.class);
                intent.setAction("com.clawchat.app.ALARM_FIRED");
                intent.putExtra("notif_id", id);
                intent.putExtra("title", title);
                intent.putExtra("body", body);
                intent.putExtra("type", type);
                intent.putExtra("item_id", itemId);
                intent.putExtra("route", route);

                PendingIntent pi = PendingIntent.getBroadcast(
                    context, id, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP, triggerAt, pi
                );

                stillValid.put(alarm);
                Log.d(TAG, "Rescheduled alarm id=" + id + " at=" + triggerAt);
            }

            // Prune expired alarms
            prefs.edit().putString(KEY_ALARMS, stillValid.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed to reschedule alarms on boot", e);
        }
    }
}
