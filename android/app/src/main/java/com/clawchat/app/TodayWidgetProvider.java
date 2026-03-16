package com.clawchat.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

public class TodayWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_DATA = "widget_json";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_DATA, null);

        String greeting = "Good morning";
        String date = "";
        JSONArray tasks = new JSONArray();
        JSONArray events = new JSONArray();
        int extraTasks = 0;

        if (json != null) {
            try {
                JSONObject data = new JSONObject(json);
                greeting = data.optString("greeting", greeting);
                date = data.optString("date", date);
                tasks = data.optJSONArray("tasks");
                if (tasks == null) tasks = new JSONArray();
                events = data.optJSONArray("events");
                if (events == null) events = new JSONArray();
                extraTasks = data.optInt("extraTasks", 0);
            } catch (Exception ignored) {}
        }

        for (int widgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);

            // Header
            views.setTextViewText(R.id.widget_greeting, greeting);
            views.setTextViewText(R.id.widget_date, date);

            // Tasks (up to 3 rows)
            int[] taskTitleIds = { R.id.task_title_1, R.id.task_title_2, R.id.task_title_3 };
            int[] taskDotIds = { R.id.task_dot_1, R.id.task_dot_2, R.id.task_dot_3 };
            int[] taskRowIds = { R.id.task_row_1, R.id.task_row_2, R.id.task_row_3 };

            for (int i = 0; i < 3; i++) {
                if (i < tasks.length()) {
                    try {
                        JSONObject task = tasks.getJSONObject(i);
                        views.setViewVisibility(taskRowIds[i], View.VISIBLE);
                        views.setTextViewText(taskTitleIds[i], task.optString("title", ""));
                        String priority = task.optString("priority", "");
                        int dotColor = getPriorityColor(priority);
                        views.setInt(taskDotIds[i], "setColorFilter", dotColor);
                    } catch (Exception ignored) {
                        views.setViewVisibility(taskRowIds[i], View.GONE);
                    }
                } else {
                    views.setViewVisibility(taskRowIds[i], View.GONE);
                }
            }

            // Extra tasks indicator
            if (extraTasks > 0) {
                views.setViewVisibility(R.id.task_extra, View.VISIBLE);
                views.setTextViewText(R.id.task_extra, "+" + extraTasks + " more");
            } else {
                views.setViewVisibility(R.id.task_extra, View.GONE);
            }

            // Events (up to 2 rows)
            int[] eventTimeIds = { R.id.event_time_1, R.id.event_time_2 };
            int[] eventTitleIds = { R.id.event_title_1, R.id.event_title_2 };
            int[] eventRowIds = { R.id.event_row_1, R.id.event_row_2 };

            for (int i = 0; i < 2; i++) {
                if (i < events.length()) {
                    try {
                        JSONObject event = events.getJSONObject(i);
                        views.setViewVisibility(eventRowIds[i], View.VISIBLE);
                        views.setTextViewText(eventTimeIds[i], event.optString("time", ""));
                        views.setTextViewText(eventTitleIds[i], event.optString("title", ""));
                    } catch (Exception ignored) {
                        views.setViewVisibility(eventRowIds[i], View.GONE);
                    }
                } else {
                    views.setViewVisibility(eventRowIds[i], View.GONE);
                }
            }

            // Click: widget body -> open Today page
            PendingIntent bodyIntent = createOpenAppIntent(context, "/");
            views.setOnClickPendingIntent(R.id.widget_root, bodyIntent);

            // Click: Chat button
            PendingIntent chatIntent = createOpenAppIntent(context, "/chats");
            views.setOnClickPendingIntent(R.id.btn_chat, chatIntent);

            // Click: Add Task button -> native quick-add dialog
            Intent quickAddIntent = new Intent(context, QuickAddTaskActivity.class);
            quickAddIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent addTaskIntent = PendingIntent.getActivity(
                context, 0x7A5C, quickAddIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.btn_add_task, addTaskIntent);

            appWidgetManager.updateAppWidget(widgetId, views);
        }
    }

    private PendingIntent createOpenAppIntent(Context context, String route) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("widget_route", route);
        // Use route hashCode as requestCode to get distinct PendingIntents
        int requestCode = route.hashCode();
        return PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private int getPriorityColor(String priority) {
        switch (priority) {
            case "high":   return 0xFFEF4444; // red
            case "medium": return 0xFFF59E0B; // amber
            case "low":    return 0xFF22C55E; // green
            default:       return 0xFF6B7280; // gray
        }
    }
}
