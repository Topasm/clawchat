package com.clawchat.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Reschedules all persisted alarms when the device reboots.
 * AlarmManager alarms are lost on reboot, so this receiver reads
 * the alarm data persisted by AlarmSchedulerPlugin and re-registers them.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        Log.d(TAG, "Device booted — rescheduling alarms");

        final PendingResult pendingResult = goAsync();
        new Thread(() -> {
            try {
                AlarmSchedulerPlugin.rescheduleAll(context);
                Log.d(TAG, "All alarms rescheduled successfully");
            } catch (Exception e) {
                Log.e(TAG, "Failed to reschedule alarms", e);
            } finally {
                pendingResult.finish();
            }
        }).start();
    }
}
