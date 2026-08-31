package com.clawchat.android.share

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.clawchat.android.MainActivity
import com.clawchat.android.R
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
internal class ShareOutboxNotifier @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    fun saved(item: ShareOutboxItem) {
        val uploadedCount = item.attachments.count(ShareOutboxAttachment::uploaded)
        val message = when {
            item.rejectedFileCount > 0 -> context.resources.getQuantityString(
                R.plurals.share_delivery_complete_with_skips,
                item.rejectedFileCount,
                uploadedCount,
                item.rejectedFileCount,
            )
            uploadedCount == 0 -> context.getString(
                R.string.share_delivery_complete_no_attachments,
            )
            else -> context.resources.getQuantityString(
                R.plurals.share_delivery_complete_with_attachments,
                uploadedCount,
                uploadedCount,
            )
        }
        show(
            item = item,
            title = context.getString(R.string.share_delivery_complete_title),
            message = message,
            allowDiscard = false,
        )
    }

    fun directConnectionRequired(item: ShareOutboxItem) {
        show(
            item,
            context.getString(R.string.share_direct_connection_title),
            context.getString(R.string.share_direct_connection_message),
            allowDiscard = true,
        )
    }

    fun connectionRequired(item: ShareOutboxItem) {
        show(
            item,
            context.getString(R.string.share_connection_required_title),
            context.getString(R.string.share_connection_required_message),
            allowDiscard = true,
        )
    }

    fun failed(item: ShareOutboxItem) {
        show(
            item,
            context.getString(R.string.share_delivery_failed_title),
            context.getString(R.string.share_delivery_failed_message),
            allowDiscard = true,
        )
    }

    private fun show(
        item: ShareOutboxItem,
        title: String,
        message: String,
        allowDiscard: Boolean,
    ) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) return
        val openIntent = PendingIntent.getActivity(
            context,
            item.notificationId(),
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(openIntent)
            .setAutoCancel(!allowDiscard)
            .setOnlyAlertOnce(true)
        if (allowDiscard) {
            val discardIntent = PendingIntent.getBroadcast(
                context,
                item.notificationId(),
                Intent(context, ShareCaptureDiscardReceiver::class.java)
                    .putExtra(EXTRA_CAPTURE_ID, item.captureId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(0, context.getString(R.string.share_discard_action), discardIntent)
                .setOngoing(true)
        }
        runCatching {
            NotificationManagerCompat.from(context).notify(item.notificationId(), builder.build())
        }
    }

    companion object {
        private const val CHANNEL_ID = "share_capture"
        internal const val EXTRA_CAPTURE_ID = "share_capture_id"

        fun createChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.share_channel_name),
                    NotificationManager.IMPORTANCE_DEFAULT,
                ),
            )
        }

        fun cancel(context: Context, captureId: String) {
            NotificationManagerCompat.from(context).cancel(captureId.hashCode() and Int.MAX_VALUE)
        }

        private fun ShareOutboxItem.notificationId(): Int =
            captureId.hashCode() and Int.MAX_VALUE
    }
}

class ShareCaptureDiscardReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val captureId = intent.getStringExtra(ShareOutboxNotifier.EXTRA_CAPTURE_ID) ?: return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val store = EntryPointAccessors.fromApplication(
                    context.applicationContext,
                    ShareDiscardEntryPoint::class.java,
                ).store()
                if (store.discard(captureId)) {
                    ShareOutboxNotifier.cancel(context, captureId)
                }
            } finally {
                pending.finish()
            }
        }
    }
}

@EntryPoint
@InstallIn(SingletonComponent::class)
internal interface ShareDiscardEntryPoint {
    fun store(): ShareOutboxStore
}
