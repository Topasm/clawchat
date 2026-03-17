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
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

public class TodayWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_DATA = "widget_json";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";
    private static final String KEY_LAST_UPDATED = "widget_last_updated";

    static final String ACTION_REFRESH = "com.clawchat.app.WIDGET_REFRESH";

    private static final long STALENESS_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            // Show loading state immediately, then fetch in background
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
                // SETUP state
                renderSetupState(context, appWidgetManager, widgetId);
            } else if (hasData && !isStale) {
                // DATA state — render content
                renderDataState(context, appWidgetManager, widgetId, json);
            } else if (hasData && isStale) {
                // DATA state but stale — render existing data and trigger background refresh
                renderDataState(context, appWidgetManager, widgetId, json);
                triggerBackgroundRefresh(context);
            } else {
                // LOADING state — have creds but no data, trigger fetch
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

        // Tap anywhere → open app
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

        // Tap → open app as fallback
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

        // Tap "Tap to refresh" → trigger refresh broadcast
        PendingIntent refreshIntent = createRefreshIntent(context);
        views.setOnClickPendingIntent(R.id.widget_empty_refresh, refreshIntent);
        views.setOnClickPendingIntent(R.id.widget_root, refreshIntent);

        // Footer buttons remain functional
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

        String greeting = "Good morning";
        String date = "";
        JSONArray tasks = new JSONArray();
        JSONArray events = new JSONArray();
        int extraTasks = 0;

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

        // Footer buttons
        setFooterClickHandlers(context, views);

        manager.updateAppWidget(widgetId, views);
    }

    // -- Helpers --

    private void setHeaderDefaults(RemoteViews views) {
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        String greeting;
        if (hour < 12) greeting = "Good morning";
        else if (hour < 17) greeting = "Good afternoon";
        else greeting = "Good evening";
        views.setTextViewText(R.id.widget_greeting, greeting);

        String date = new SimpleDateFormat("MMM d", Locale.US).format(new Date());
        views.setTextViewText(R.id.widget_date, date);
    }

    private void setFooterClickHandlers(Context context, RemoteViews views) {
        // Chat button
        PendingIntent chatIntent = createOpenAppIntent(context, "/chats");
        views.setOnClickPendingIntent(R.id.btn_chat, chatIntent);

        // Add Task button → native quick-add dialog
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

    private void fetchAndUpdateData(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_AUTH_TOKEN, "");

        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            updateAllWidgets(context);
            return;
        }

        try {
            URL url = new URL(serverUrl + "/api/today");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int responseCode = conn.getResponseCode();

            if (responseCode == 401) {
                // Session expired — clear auth + data, revert to SETUP
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
            // On other errors: keep stale data if available (will fall through to updateAllWidgets)

            conn.disconnect();
        } catch (Exception ignored) {
            // Network error — keep stale data if available
        }

        updateAllWidgets(context);
    }

    /**
     * Transforms the /api/today API response into the widget JSON format.
     * API: { today_tasks, overdue_tasks, today_events, greeting, date, ... }
     * Widget: { greeting, date, tasks[], extraTasks, events[] }
     */
    private String transformApiResponse(String apiJson) {
        try {
            JSONObject api = new JSONObject(apiJson);

            // Combine today_tasks + overdue_tasks
            JSONArray todayTasks = api.optJSONArray("today_tasks");
            JSONArray overdueTasks = api.optJSONArray("overdue_tasks");
            if (todayTasks == null) todayTasks = new JSONArray();
            if (overdueTasks == null) overdueTasks = new JSONArray();

            JSONArray allTasks = new JSONArray();
            for (int i = 0; i < todayTasks.length(); i++) {
                allTasks.put(todayTasks.getJSONObject(i));
            }
            for (int i = 0; i < overdueTasks.length(); i++) {
                allTasks.put(overdueTasks.getJSONObject(i));
            }

            // Build widget tasks (up to 3)
            JSONArray widgetTasks = new JSONArray();
            int displayCount = Math.min(3, allTasks.length());
            for (int i = 0; i < displayCount; i++) {
                JSONObject t = allTasks.getJSONObject(i);
                JSONObject wt = new JSONObject();
                wt.put("title", t.optString("title", ""));
                wt.put("priority", t.optString("priority", ""));
                widgetTasks.put(wt);
            }

            int extraTasks = Math.max(0, allTasks.length() - 3);

            // Build widget events (up to 2)
            JSONArray todayEvents = api.optJSONArray("today_events");
            if (todayEvents == null) todayEvents = new JSONArray();

            JSONArray widgetEvents = new JSONArray();
            int eventCount = Math.min(2, todayEvents.length());
            for (int i = 0; i < eventCount; i++) {
                JSONObject e = todayEvents.getJSONObject(i);
                JSONObject we = new JSONObject();
                we.put("title", e.optString("title", ""));
                we.put("time", formatEventTime(e.optString("start_time", "")));
                widgetEvents.put(we);
            }

            // Greeting
            String greeting = api.optString("greeting", "Good morning");

            // Date — API returns "YYYY-MM-DD", format to "Mon D"
            String dateStr = formatDateForWidget(api.optString("date", ""));

            JSONObject widget = new JSONObject();
            widget.put("greeting", greeting);
            widget.put("date", dateStr);
            widget.put("tasks", widgetTasks);
            widget.put("extraTasks", extraTasks);
            widget.put("events", widgetEvents);

            return widget.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /**
     * Format ISO datetime string to "H:MM" for widget display.
     * Input: "2026-03-17T14:30:00" or similar
     */
    private String formatEventTime(String isoDateTime) {
        if (isoDateTime == null || isoDateTime.isEmpty()) return "";
        try {
            // Handle various ISO formats by parsing the time portion
            String timePart = isoDateTime;
            if (isoDateTime.contains("T")) {
                timePart = isoDateTime.substring(isoDateTime.indexOf("T") + 1);
            }
            // Parse "HH:MM:SS" or "HH:MM"
            String[] parts = timePart.split(":");
            int h = Integer.parseInt(parts[0]);
            int m = Integer.parseInt(parts[1]);
            return h + ":" + String.format(Locale.US, "%02d", m);
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * Format "YYYY-MM-DD" to "Mon D" (e.g. "Mar 17")
     */
    private String formatDateForWidget(String dateStr) {
        if (dateStr == null || dateStr.isEmpty()) {
            return new SimpleDateFormat("MMM d", Locale.US).format(new Date());
        }
        try {
            SimpleDateFormat input = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            Date d = input.parse(dateStr);
            if (d != null) {
                return new SimpleDateFormat("MMM d", Locale.US).format(d);
            }
        } catch (Exception ignored) {}
        return new SimpleDateFormat("MMM d", Locale.US).format(new Date());
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

    private int getPriorityColor(String priority) {
        switch (priority) {
            case "high":   return 0xFFEF4444; // red
            case "medium": return 0xFFF59E0B; // amber
            case "low":    return 0xFF22C55E; // green
            default:       return 0xFF6B7280; // gray
        }
    }
}
