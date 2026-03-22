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

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class TodayWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_DATA = "widget_json";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";
    private static final String KEY_LAST_UPDATED = "widget_last_updated";

    static final String ACTION_REFRESH = "com.clawchat.app.WIDGET_REFRESH";
    static final String ACTION_COMPLETE_TASK = "com.clawchat.app.WIDGET_COMPLETE_TASK";

    private static final long STALENESS_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_COMPLETE_TASK.equals(intent.getAction())) {
            String taskId = intent.getStringExtra("task_id");
            if (taskId != null && !taskId.isEmpty()) {
                final android.content.BroadcastReceiver.PendingResult pendingResult = goAsync();
                new Thread(() -> {
                    try {
                        completeTask(context, taskId);
                    } finally {
                        pendingResult.finish();
                    }
                }).start();
            }
            return;
        }

        if (ACTION_REFRESH.equals(intent.getAction())) {
            showLoadingState(context);
            final android.content.BroadcastReceiver.PendingResult pendingResult = goAsync();
            new Thread(() -> {
                try {
                    fetchAndUpdateData(context);
                } finally {
                    pendingResult.finish();
                }
            }).start();
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_AUTH_TOKEN, "");
        String json = prefs.getString(KEY_DATA, null);
        long lastUpdated = prefs.getLong(KEY_LAST_UPDATED, 0);

        boolean hasCreds = serverUrl != null && !serverUrl.isEmpty()
                && token != null && !token.isEmpty();
        boolean hasData = json != null && !json.isEmpty();
        boolean isStale = (System.currentTimeMillis() - lastUpdated) > STALENESS_THRESHOLD_MS;

        for (int widgetId : appWidgetIds) {
            if (!hasCreds) {
                renderSetupState(context, appWidgetManager, widgetId);
            } else if (hasData && !isStale) {
                renderDataState(context, appWidgetManager, widgetId, json);
            } else if (hasData && isStale) {
                renderDataState(context, appWidgetManager, widgetId, json);
                triggerBackgroundRefresh(context);
            } else {
                renderLoadingState(context, appWidgetManager, widgetId);
                triggerBackgroundRefresh(context);
            }
        }
    }

    // -- State renderers --

    private void renderSetupState(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        setHeaderDefaults(views);

        views.setViewVisibility(R.id.widget_content, View.GONE);
        views.setViewVisibility(R.id.widget_empty_setup, View.VISIBLE);
        views.setViewVisibility(R.id.widget_empty_refresh, View.GONE);
        views.setViewVisibility(R.id.widget_loading, View.GONE);
        views.setViewVisibility(R.id.widget_footer, View.GONE);

        PendingIntent openApp = createOpenAppIntent(context, "/");
        views.setOnClickPendingIntent(R.id.widget_root, openApp);
        views.setOnClickPendingIntent(R.id.widget_empty_setup, openApp);

        manager.updateAppWidget(widgetId, views);
    }

    private void renderLoadingState(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        setHeaderDefaults(views);

        views.setViewVisibility(R.id.widget_content, View.GONE);
        views.setViewVisibility(R.id.widget_empty_setup, View.GONE);
        views.setViewVisibility(R.id.widget_empty_refresh, View.GONE);
        views.setViewVisibility(R.id.widget_loading, View.VISIBLE);
        views.setViewVisibility(R.id.widget_footer, View.GONE);

        PendingIntent openApp = createOpenAppIntent(context, "/");
        views.setOnClickPendingIntent(R.id.widget_root, openApp);

        manager.updateAppWidget(widgetId, views);
    }

    private void renderRefreshState(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        setHeaderDefaults(views);

        views.setViewVisibility(R.id.widget_content, View.GONE);
        views.setViewVisibility(R.id.widget_empty_setup, View.GONE);
        views.setViewVisibility(R.id.widget_empty_refresh, View.VISIBLE);
        views.setViewVisibility(R.id.widget_loading, View.GONE);
        views.setViewVisibility(R.id.widget_footer, View.VISIBLE);

        PendingIntent refreshIntent = createRefreshIntent(context);
        views.setOnClickPendingIntent(R.id.widget_empty_refresh, refreshIntent);
        views.setOnClickPendingIntent(R.id.widget_root, refreshIntent);

        setFooterClickHandlers(context, views);

        manager.updateAppWidget(widgetId, views);
    }

    private void renderDataState(Context context, AppWidgetManager manager, int widgetId, String json) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);

        views.setViewVisibility(R.id.widget_content, View.VISIBLE);
        views.setViewVisibility(R.id.widget_empty_setup, View.GONE);
        views.setViewVisibility(R.id.widget_empty_refresh, View.GONE);
        views.setViewVisibility(R.id.widget_loading, View.GONE);
        views.setViewVisibility(R.id.widget_footer, View.VISIBLE);

        JSONArray tasks = new JSONArray();
        int total = 0;

        try {
            JSONObject data = new JSONObject(json);
            tasks = data.optJSONArray("tasks");
            if (tasks == null) tasks = new JSONArray();
            total = data.optInt("total", 0);
        } catch (Exception ignored) {}

        // Header
        views.setTextViewText(R.id.widget_header_label, "Tasks");
        views.setTextViewText(R.id.widget_header_count, String.valueOf(total));

        // Task rows (up to 5)
        int[] taskCheckIds = { R.id.task_check_1, R.id.task_check_2, R.id.task_check_3, R.id.task_check_4, R.id.task_check_5 };
        int[] taskTitleIds = { R.id.task_title_1, R.id.task_title_2, R.id.task_title_3, R.id.task_title_4, R.id.task_title_5 };
        int[] taskRowIds = { R.id.task_row_1, R.id.task_row_2, R.id.task_row_3, R.id.task_row_4, R.id.task_row_5 };

        int displayCount = Math.min(5, tasks.length());

        for (int i = 0; i < 5; i++) {
            if (i < displayCount) {
                try {
                    JSONObject task = tasks.getJSONObject(i);
                    String taskId = task.optString("id", "");
                    views.setViewVisibility(taskRowIds[i], View.VISIBLE);
                    views.setTextViewText(taskTitleIds[i], task.optString("title", ""));

                    // Checkbox tap → complete task
                    if (!taskId.isEmpty()) {
                        Intent completeIntent = new Intent(context, TodayWidgetProvider.class);
                        completeIntent.setAction(ACTION_COMPLETE_TASK);
                        completeIntent.putExtra("task_id", taskId);
                        // Use unique data URI to prevent PendingIntent reuse
                        completeIntent.setData(android.net.Uri.parse("clawchat://complete/" + taskId));
                        PendingIntent completePending = PendingIntent.getBroadcast(
                            context, taskId.hashCode(), completeIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        );
                        views.setOnClickPendingIntent(taskCheckIds[i], completePending);
                    }

                    // Title tap → open app
                    PendingIntent openApp = createOpenAppIntent(context, "/");
                    views.setOnClickPendingIntent(taskTitleIds[i], openApp);

                } catch (Exception ignored) {
                    views.setViewVisibility(taskRowIds[i], View.GONE);
                }
            } else {
                views.setViewVisibility(taskRowIds[i], View.GONE);
            }
        }

        // Extra tasks indicator
        int remaining = total - displayCount;
        if (remaining > 0) {
            views.setViewVisibility(R.id.task_extra, View.VISIBLE);
            views.setTextViewText(R.id.task_extra, "+" + remaining + " more");
        } else {
            views.setViewVisibility(R.id.task_extra, View.GONE);
        }

        // Click: widget body -> open app
        PendingIntent bodyIntent = createOpenAppIntent(context, "/");
        views.setOnClickPendingIntent(R.id.widget_root, bodyIntent);

        // Footer
        setFooterClickHandlers(context, views);

        manager.updateAppWidget(widgetId, views);
    }

    // -- Helpers --

    private void setHeaderDefaults(RemoteViews views) {
        views.setTextViewText(R.id.widget_header_label, "Tasks");
        views.setTextViewText(R.id.widget_header_count, "");
    }

    private void setFooterClickHandlers(Context context, RemoteViews views) {
        Intent quickAddIntent = new Intent(context, QuickAddTaskActivity.class);
        quickAddIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent addTaskIntent = PendingIntent.getActivity(
            context, 0x7A5C, quickAddIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.btn_add_task, addTaskIntent);
    }

    private void showLoadingState(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName widget = new ComponentName(context, TodayWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(widget);
        for (int id : ids) {
            renderLoadingState(context, manager, id);
        }
    }

    private void triggerBackgroundRefresh(Context context) {
        Intent refreshIntent = new Intent(context, TodayWidgetProvider.class);
        refreshIntent.setAction(ACTION_REFRESH);
        context.sendBroadcast(refreshIntent);
    }

    private void completeTask(Context context, String taskId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_AUTH_TOKEN, "");

        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            return;
        }

        try {
            URL url = new URL(serverUrl + "/api/todos/" + taskId);
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
            if (responseCode == 401) {
                prefs.edit()
                    .remove(KEY_AUTH_TOKEN)
                    .remove(KEY_DATA)
                    .remove(KEY_LAST_UPDATED)
                    .apply();
            }
            conn.disconnect();
        } catch (Exception ignored) {}

        // Refresh widget with fresh data
        fetchAndUpdateData(context);
    }

    private void fetchAndUpdateData(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_AUTH_TOKEN, "");

        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            updateAllWidgets(context);
            return;
        }

        try {
            URL url = new URL(serverUrl + "/api/todos?status=pending&root_only=true&limit=6&order_by=created_at&order_dir=desc");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int responseCode = conn.getResponseCode();

            if (responseCode == 401) {
                prefs.edit()
                    .remove(KEY_AUTH_TOKEN)
                    .remove(KEY_DATA)
                    .remove(KEY_LAST_UPDATED)
                    .apply();
                conn.disconnect();
                updateAllWidgets(context);
                return;
            }

            if (responseCode == 200) {
                BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();

                String widgetJson = transformApiResponse(sb.toString());
                prefs.edit()
                    .putString(KEY_DATA, widgetJson)
                    .putLong(KEY_LAST_UPDATED, System.currentTimeMillis())
                    .apply();
            }

            conn.disconnect();
        } catch (Exception ignored) {}

        updateAllWidgets(context);
    }

    /**
     * Transforms the /api/todos paginated response into the widget JSON format.
     * API: { items: [...], total, page, limit }
     * Widget: { tasks: [{id, title, priority}], total }
     */
    private String transformApiResponse(String apiJson) {
        try {
            JSONObject api = new JSONObject(apiJson);
            JSONArray items = api.optJSONArray("items");
            if (items == null) items = new JSONArray();
            int total = api.optInt("total", 0);

            JSONArray widgetTasks = new JSONArray();
            int displayCount = Math.min(5, items.length());
            for (int i = 0; i < displayCount; i++) {
                JSONObject t = items.getJSONObject(i);
                JSONObject wt = new JSONObject();
                wt.put("id", t.optString("id", ""));
                wt.put("title", t.optString("title", ""));
                wt.put("priority", t.optString("priority", ""));
                widgetTasks.put(wt);
            }

            JSONObject widget = new JSONObject();
            widget.put("tasks", widgetTasks);
            widget.put("total", total);
            return widget.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private void updateAllWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName widget = new ComponentName(context, TodayWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(widget);
        if (ids.length > 0) {
            onUpdate(context, manager, ids);
        }
    }

    private PendingIntent createOpenAppIntent(Context context, String route) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("widget_route", route);
        int requestCode = route.hashCode();
        return PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private PendingIntent createRefreshIntent(Context context) {
        Intent intent = new Intent(context, TodayWidgetProvider.class);
        intent.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(
            context, 0xBEEF, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
