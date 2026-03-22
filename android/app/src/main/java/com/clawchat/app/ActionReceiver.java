package com.clawchat.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Handles notification action buttons without opening the app.
 * - MARK_TASK_DONE: sends PATCH /api/todos/{id} to mark task completed
 * - SNOOZE_REMINDER: reschedules the alarm 15 minutes later
 */
public class ActionReceiver extends BroadcastReceiver {

    private static final String TAG = "ActionReceiver";
    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";

    private static final long SNOOZE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        Log.d(TAG, "Action received: " + action);

        switch (action) {
            case "com.clawchat.app.MARK_TASK_DONE":
                handleMarkTaskDone(context, intent);
                break;
            case "com.clawchat.app.SNOOZE_REMINDER":
                handleSnooze(context, intent);
                break;
            default:
                Log.w(TAG, "Unknown action: " + action);
        }
    }

    private void handleMarkTaskDone(Context context, Intent intent) {
        String todoId = intent.getStringExtra("todo_id");
        int notifId = intent.getIntExtra("notif_id", -1);

        if (todoId == null || todoId.isEmpty()) return;

        // Dismiss the notification immediately
        if (notifId >= 0) {
            NotificationManagerCompat.from(context).cancel(notifId);
        }

        // Send HTTP PATCH in background
        final PendingResult pendingResult = goAsync();
        new Thread(() -> {
            try {
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String serverUrl = prefs.getString(KEY_SERVER_URL, "");
                String token = prefs.getString(KEY_AUTH_TOKEN, "");

                if (serverUrl == null || serverUrl.isEmpty() ||
                    token == null || token.isEmpty()) {
                    Log.w(TAG, "No server credentials — cannot mark task done");
                    return;
                }

                URL url = new URL(serverUrl + "/api/todos/" + todoId);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("PATCH");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);

                JSONObject body = new JSONObject();
                body.put("status", "completed");

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }

                int responseCode = conn.getResponseCode();
                conn.disconnect();

                if (responseCode == 200 || responseCode == 204) {
                    Log.d(TAG, "Task " + todoId + " marked done");
                } else {
                    Log.w(TAG, "Failed to mark task done: HTTP " + responseCode);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error marking task done", e);
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    private void handleSnooze(Context context, Intent intent) {
        int notifId = intent.getIntExtra("notif_id", -1);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String type = intent.getStringExtra("type");
        String itemId = intent.getStringExtra("item_id");
        String route = intent.getStringExtra("route");

        // Dismiss current notification
        if (notifId >= 0) {
            NotificationManagerCompat.from(context).cancel(notifId);
        }

        // Reschedule alarm 15 minutes from now
        long newTriggerAt = System.currentTimeMillis() + SNOOZE_DURATION_MS;

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

        Intent alarmIntent = new Intent(context, NotificationReceiver.class);
        alarmIntent.setAction("com.clawchat.app.ALARM_FIRED");
        alarmIntent.putExtra("notif_id", notifId);
        alarmIntent.putExtra("title", title != null ? title : "Reminder");
        alarmIntent.putExtra("body", body != null ? body : "");
        alarmIntent.putExtra("type", type != null ? type : "event");
        alarmIntent.putExtra("item_id", itemId != null ? itemId : "");
        alarmIntent.putExtra("route", route != null ? route : "");

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context, notifId, alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP, newTriggerAt, pendingIntent
        );

        Log.d(TAG, "Snoozed notification id=" + notifId + " for 15 minutes");
    }
}
