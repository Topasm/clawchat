package com.clawchat.android.core.notification

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat

/**
 * Runtime state of the notification permission.
 *
 * Android 13 introduced [Manifest.permission.POST_NOTIFICATIONS]: declaring it
 * in the manifest is not enough, and a notification posted without it is
 * dropped without an error. Reminders are a core feature here, so the app has
 * to ask rather than assume.
 */
object NotificationPermission {

    const val PERMISSION: String = Manifest.permission.POST_NOTIFICATIONS

    /** True on the versions where the permission must be requested at runtime. */
    fun isRuntimePermission(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    /**
     * True when a posted notification will actually be shown. This also covers
     * the user switching notifications off in system settings, which no
     * permission request can undo.
     */
    fun isGranted(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()
}
