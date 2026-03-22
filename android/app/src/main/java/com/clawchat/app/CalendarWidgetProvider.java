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

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Home screen widget showing upcoming calendar events.
 * Data is synced from the React frontend via WidgetDataPlugin.setCalendarWidgetData().
 */
public class CalendarWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_CALENDAR_DATA = "calendar_widget_json";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";

    static final String ACTION_REFRESH = "com.clawchat.app.CALENDAR_WIDGET_REFRESH";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_AUTH_TOKEN, "");
        String json = prefs.getString(KEY_CALENDAR_DATA, null);

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
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar);
        setHeaderDefaults(views);

        views.setViewVisibility(R.id.calendar_content, View.GONE);
        views.setViewVisibility(R.id.calendar_empty, View.GONE);
        views.setViewVisibility(R.id.calendar_loading, View.GONE);
        views.setViewVisibility(R.id.calendar_setup, View.VISIBLE);
        views.setViewVisibility(R.id.calendar_footer, View.GONE);

        PendingIntent openApp = createOpenAppIntent(context, "/calendar");
        views.setOnClickPendingIntent(R.id.widget_root, openApp);

        manager.updateAppWidget(widgetId, views);
    }

    private void renderEmptyState(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar);
        setHeaderDefaults(views);

        views.setViewVisibility(R.id.calendar_content, View.GONE);
        views.setViewVisibility(R.id.calendar_empty, View.VISIBLE);
        views.setViewVisibility(R.id.calendar_loading, View.GONE);
        views.setViewVisibility(R.id.calendar_setup, View.GONE);
        views.setViewVisibility(R.id.calendar_footer, View.VISIBLE);

        setFooterClickHandlers(context, views);

        PendingIntent openApp = createOpenAppIntent(context, "/calendar");
        views.setOnClickPendingIntent(R.id.widget_root, openApp);

        manager.updateAppWidget(widgetId, views);
    }

    private void renderDataState(Context context, AppWidgetManager manager, int widgetId, String json) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar);

        String month = "";
        JSONArray events = new JSONArray();
        int totalEvents = 0;

        try {
            JSONObject data = new JSONObject(json);
            month = data.optString("month", "");
            events = data.optJSONArray("events");
            if (events == null) events = new JSONArray();
            totalEvents = data.optInt("totalEvents", events.length());
        } catch (Exception ignored) {}

        if (month.isEmpty()) {
            month = new SimpleDateFormat("MMMM yyyy", Locale.US).format(new Date());
        }
        views.setTextViewText(R.id.calendar_month, month);
        views.setTextViewText(R.id.calendar_event_count, totalEvents + " events");

        if (events.length() == 0) {
            views.setViewVisibility(R.id.calendar_content, View.GONE);
            views.setViewVisibility(R.id.calendar_empty, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.calendar_content, View.VISIBLE);
            views.setViewVisibility(R.id.calendar_empty, View.GONE);
        }
        views.setViewVisibility(R.id.calendar_loading, View.GONE);
        views.setViewVisibility(R.id.calendar_setup, View.GONE);
        views.setViewVisibility(R.id.calendar_footer, View.VISIBLE);

        // Event rows (up to 3)
        int[] timeIds = { R.id.event_time_1, R.id.event_time_2, R.id.event_time_3 };
        int[] titleIds = { R.id.event_title_1, R.id.event_title_2, R.id.event_title_3 };
        int[] rowIds = { R.id.event_row_1, R.id.event_row_2, R.id.event_row_3 };

        for (int i = 0; i < 3; i++) {
            if (i < events.length()) {
                try {
                    JSONObject event = events.getJSONObject(i);
                    views.setViewVisibility(rowIds[i], View.VISIBLE);
                    views.setTextViewText(timeIds[i], event.optString("time", ""));
                    views.setTextViewText(titleIds[i], event.optString("title", ""));
                } catch (Exception ignored) {
                    views.setViewVisibility(rowIds[i], View.GONE);
                }
            } else {
                views.setViewVisibility(rowIds[i], View.GONE);
            }
        }

        PendingIntent bodyIntent = createOpenAppIntent(context, "/calendar");
        views.setOnClickPendingIntent(R.id.widget_root, bodyIntent);

        setFooterClickHandlers(context, views);

        manager.updateAppWidget(widgetId, views);
    }

    private void setHeaderDefaults(RemoteViews views) {
        String month = new SimpleDateFormat("MMMM yyyy", Locale.US).format(new Date());
        views.setTextViewText(R.id.calendar_month, month);
        views.setTextViewText(R.id.calendar_event_count, "");
    }

    private void setFooterClickHandlers(Context context, RemoteViews views) {
        PendingIntent calendarIntent = createOpenAppIntent(context, "/calendar");
        views.setOnClickPendingIntent(R.id.btn_open_calendar, calendarIntent);
    }

    private PendingIntent createOpenAppIntent(Context context, String route) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("widget_route", route);
        int requestCode = ("calendar_" + route).hashCode();
        return PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void updateAllWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName widget = new ComponentName(context, CalendarWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(widget);
        if (ids.length > 0) {
            onUpdate(context, manager, ids);
        }
    }
}
