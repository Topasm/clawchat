package com.clawchat.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home screen widget showing task status breakdown (To Do / In Progress / Done)
 * and top priority pending tasks.
 * Data is synced from the React frontend via WidgetDataPlugin.setKanbanWidgetData().
 */
public class KanbanWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_KANBAN_DATA = "kanban_widget_json";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";

    static final String ACTION_REFRESH = "com.clawchat.app.KANBAN_WIDGET_REFRESH";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_AUTH_TOKEN, "");
        String json = prefs.getString(KEY_KANBAN_DATA, null);

        boolean hasCreds = serverUrl != null && !serverUrl.isEmpty()
                && token != null && !token.isEmpty();
        boolean hasData = json != null && !json.isEmpty();

        for (int widgetId : appWidgetIds) {
            if (!hasCreds) {
                renderSetupState(context, manager, widgetId);
            } else if (hasData) {
                renderDataState(context, manager, widgetId, json);
            } else {
                renderEmptyState(context, manager, widgetId);
            }
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            updateAllWidgets(context);
            return;
        }
        super.onReceive(context, intent);
    }

    private void renderSetupState(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_kanban);
        views.setTextViewText(R.id.kanban_title, "Tasks");
        views.setTextViewText(R.id.kanban_total, "");

        views.setViewVisibility(R.id.kanban_content, View.GONE);
        views.setViewVisibility(R.id.kanban_tasks, View.GONE);
        views.setViewVisibility(R.id.kanban_empty, View.GONE);
        views.setViewVisibility(R.id.kanban_setup, View.VISIBLE);
        views.setViewVisibility(R.id.kanban_footer, View.GONE);

        PendingIntent openApp = createOpenAppIntent(context, "/tasks");
        views.setOnClickPendingIntent(R.id.widget_root, openApp);

        manager.updateAppWidget(widgetId, views);
    }

    private void renderEmptyState(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_kanban);
        views.setTextViewText(R.id.kanban_title, "Tasks");
        views.setTextViewText(R.id.kanban_total, "");

        views.setViewVisibility(R.id.kanban_content, View.GONE);
        views.setViewVisibility(R.id.kanban_tasks, View.GONE);
        views.setViewVisibility(R.id.kanban_empty, View.VISIBLE);
        views.setViewVisibility(R.id.kanban_setup, View.GONE);
        views.setViewVisibility(R.id.kanban_footer, View.VISIBLE);

        setFooterClickHandlers(context, views);

        PendingIntent openApp = createOpenAppIntent(context, "/tasks");
        views.setOnClickPendingIntent(R.id.widget_root, openApp);

        manager.updateAppWidget(widgetId, views);
    }

    private void renderDataState(Context context, AppWidgetManager manager, int widgetId, String json) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_kanban);

        int todoCount = 0, progressCount = 0, doneCount = 0;
        JSONArray topTasks = new JSONArray();

        try {
            JSONObject data = new JSONObject(json);
            todoCount = data.optInt("todoCount", 0);
            progressCount = data.optInt("progressCount", 0);
            doneCount = data.optInt("doneCount", 0);
            topTasks = data.optJSONArray("topTasks");
            if (topTasks == null) topTasks = new JSONArray();
        } catch (Exception ignored) {}

        int total = todoCount + progressCount + doneCount;
        views.setTextViewText(R.id.kanban_title, "Tasks");
        views.setTextViewText(R.id.kanban_total, total + " total");

        views.setTextViewText(R.id.kanban_todo_count, String.valueOf(todoCount));
        views.setTextViewText(R.id.kanban_progress_count, String.valueOf(progressCount));
        views.setTextViewText(R.id.kanban_done_count, String.valueOf(doneCount));

        views.setViewVisibility(R.id.kanban_content, View.VISIBLE);
        views.setViewVisibility(R.id.kanban_empty, View.GONE);
        views.setViewVisibility(R.id.kanban_setup, View.GONE);
        views.setViewVisibility(R.id.kanban_footer, View.VISIBLE);

        // Top priority tasks (up to 3)
        int[] dotIds = { R.id.priority_dot_1, R.id.priority_dot_2, R.id.priority_dot_3 };
        int[] titleIds = { R.id.priority_title_1, R.id.priority_title_2, R.id.priority_title_3 };
        int[] rowIds = { R.id.priority_row_1, R.id.priority_row_2, R.id.priority_row_3 };

        boolean hasTopTasks = false;
        for (int i = 0; i < 3; i++) {
            if (i < topTasks.length()) {
                try {
                    JSONObject task = topTasks.getJSONObject(i);
                    views.setViewVisibility(rowIds[i], View.VISIBLE);
                    views.setTextViewText(titleIds[i], task.optString("title", ""));
                    int dotColor = getPriorityColor(task.optString("priority", ""));
                    views.setInt(dotIds[i], "setColorFilter", dotColor);
                    hasTopTasks = true;
                } catch (Exception ignored) {
                    views.setViewVisibility(rowIds[i], View.GONE);
                }
            } else {
                views.setViewVisibility(rowIds[i], View.GONE);
            }
        }

        views.setViewVisibility(R.id.kanban_tasks, hasTopTasks ? View.VISIBLE : View.GONE);

        PendingIntent bodyIntent = createOpenAppIntent(context, "/tasks");
        views.setOnClickPendingIntent(R.id.widget_root, bodyIntent);

        setFooterClickHandlers(context, views);

        manager.updateAppWidget(widgetId, views);
    }

    private void setFooterClickHandlers(Context context, RemoteViews views) {
        PendingIntent tasksIntent = createOpenAppIntent(context, "/tasks");
        views.setOnClickPendingIntent(R.id.btn_open_tasks, tasksIntent);
    }

    private PendingIntent createOpenAppIntent(Context context, String route) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("widget_route", route);
        int requestCode = ("kanban_" + route).hashCode();
        return PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void updateAllWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName widget = new ComponentName(context, KanbanWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(widget);
        if (ids.length > 0) {
            onUpdate(context, manager, ids);
        }
    }

    private int getPriorityColor(String priority) {
        switch (priority) {
            case "high":   return 0xFFEF4444;
            case "medium": return 0xFFF59E0B;
            case "low":    return 0xFF22C55E;
            default:       return 0xFF6B7280;
        }
    }
}
