package com.clawchat.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WidgetData")
public class WidgetDataPlugin extends Plugin {

    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_DATA = "widget_json";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";

    @PluginMethod
    public void setWidgetData(PluginCall call) {
        String json = call.getString("data");
        if (json == null) {
            call.reject("Missing 'data' parameter");
            return;
        }

        String serverUrl = call.getString("serverUrl", "");
        String token = call.getString("token", "");

        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_DATA, json)
            .putString(KEY_SERVER_URL, serverUrl)
            .putString(KEY_AUTH_TOKEN, token)
            .apply();

        refreshWidget(ctx);
        call.resolve();
    }

    @PluginMethod
    public void refreshWidget(PluginCall call) {
        refreshWidget(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setCalendarWidgetData(PluginCall call) {
        String json = call.getString("data");
        if (json == null) {
            call.reject("Missing 'data' parameter");
            return;
        }

        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString("calendar_widget_json", json).apply();

        refreshWidgetClass(ctx, CalendarWidgetProvider.class);
        call.resolve();
    }

    @PluginMethod
    public void setKanbanWidgetData(PluginCall call) {
        String json = call.getString("data");
        if (json == null) {
            call.reject("Missing 'data' parameter");
            return;
        }

        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString("kanban_widget_json", json).apply();

        refreshWidgetClass(ctx, KanbanWidgetProvider.class);
        call.resolve();
    }

    private void refreshWidget(Context ctx) {
        refreshWidgetClass(ctx, TodayWidgetProvider.class);
    }

    private void refreshWidgetClass(Context ctx, Class<?> widgetClass) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        ComponentName widget = new ComponentName(ctx, widgetClass);
        int[] ids = manager.getAppWidgetIds(widget);
        if (ids.length > 0) {
            Intent intent = new Intent(ctx, widgetClass);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            ctx.sendBroadcast(intent);
        }
    }
}
