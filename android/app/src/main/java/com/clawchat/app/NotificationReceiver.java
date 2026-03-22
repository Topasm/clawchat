package com.clawchat.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * BroadcastReceiver that fires when an AlarmManager alarm triggers.
 * Builds and posts a notification with optional action buttons
 * (Mark Done for tasks, Snooze for both tasks and events).
 */
public class NotificationReceiver extends BroadcastReceiver {

    private static final String TAG = "NotificationReceiver";
    private static final String CHANNEL_ID = "clawchat_reminders";
    private static final String CHANNEL_NAME = "Reminders";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        int notifId = intent.getIntExtra("notif_id", -1);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String type = intent.getStringExtra("type");
        String itemId = intent.getStringExtra("item_id");
        String route = intent.getStringExtra("route");

        if (notifId < 0 || title == null) return;

        Log.d(TAG, "Alarm fired: id=" + notifId + " type=" + type + " title=" + title);

        ensureNotificationChannel(context);

        // Content intent — tap notification to open deep link
        PendingIntent contentIntent = createContentIntent(context, route, notifId);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(getNotificationIcon())
            .setContentTitle(title)
            .setContentText(body != null && !body.isEmpty() ? body : null)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        // Add "Done" action for task notifications
        if ("task".equals(type) && itemId != null && !itemId.isEmpty()) {
            Intent doneIntent = new Intent(context, ActionReceiver.class);
            doneIntent.setAction("com.clawchat.app.MARK_TASK_DONE");
            doneIntent.putExtra("todo_id", itemId);
            doneIntent.putExtra("notif_id", notifId);
            PendingIntent donePending = PendingIntent.getBroadcast(
                context, notifId + 10000, doneIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(getNotificationIcon(), "Done", donePending);
        }

        // Add "Snooze" action for all notification types
        Intent snoozeIntent = new Intent(context, ActionReceiver.class);
        snoozeIntent.setAction("com.clawchat.app.SNOOZE_REMINDER");
        snoozeIntent.putExtra("notif_id", notifId);
        snoozeIntent.putExtra("title", title);
        snoozeIntent.putExtra("body", body != null ? body : "");
        snoozeIntent.putExtra("type", type != null ? type : "event");
        snoozeIntent.putExtra("item_id", itemId != null ? itemId : "");
        snoozeIntent.putExtra("route", route != null ? route : "");
        PendingIntent snoozePending = PendingIntent.getBroadcast(
            context, notifId + 20000, snoozeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder.addAction(getNotificationIcon(), "Snooze", snoozePending);

        // Post notification
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(context).notify(notifId, builder.build());
        } else {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted");
        }
    }

    private void ensureNotificationChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Task and event reminders");
        NotificationManager manager = (NotificationManager)
            context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(channel);
    }

    private PendingIntent createContentIntent(Context context, String route, int notifId) {
        Intent intent;
        if (route != null && !route.isEmpty()) {
            // Open via deep link
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse("clawchat:/" + route));
            intent.setPackage(context.getPackageName());
        } else {
            // Fallback: open app
            intent = new Intent(context, MainActivity.class);
        }
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context, notifId + 30000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private int getNotificationIcon() {
        // Use the app's launcher icon; if ic_stat_clawchat exists as a status bar icon, use that
        try {
            int resId = R.drawable.ic_stat_clawchat;
            return resId;
        } catch (Exception e) {
            return android.R.drawable.ic_dialog_info;
        }
    }
}
