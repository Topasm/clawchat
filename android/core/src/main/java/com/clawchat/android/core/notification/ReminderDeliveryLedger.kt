package com.clawchat.android.core.notification

import android.content.Context
import androidx.core.content.edit

/**
 * Persistent, process-safe-enough record of reminders already handed to Android.
 *
 * WorkManager may run in a fresh process, and a WebSocket reminder can race the
 * periodic recovery check. Keeping the claims in SharedPreferences prevents
 * both paths from alerting the user for the same reminder.
 */
internal class ReminderDeliveryLedger(
    context: Context,
) : ReminderClaimStore, ReminderCacheTrustStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    override fun claim(key: String, claimedAtMillis: Long, suppressForMillis: Long): Boolean =
        synchronized(lock) {
            val previous = preferences.getLong(key, Long.MIN_VALUE)
            if (
                previous != Long.MIN_VALUE &&
                claimedAtMillis - previous in 0 until suppressForMillis
            ) {
                return@synchronized false
            }

            preferences.edit {
                putLong(key, claimedAtMillis)
                preferences.all.forEach { (storedKey, value) ->
                    val storedAt = value as? Long ?: return@forEach
                    if (claimedAtMillis - storedAt > MAX_ENTRY_AGE_MILLIS) {
                        remove(storedKey)
                    }
                }
            }
            // SharedPreferences.edit applies the in-memory map before
            // returning, so another claimant in this process observes the
            // reservation immediately.
            true
        }

    override fun release(key: String, claimedAtMillis: Long) {
        synchronized(lock) {
            if (preferences.getLong(key, Long.MIN_VALUE) == claimedAtMillis) {
                preferences.edit { remove(key) }
            }
        }
    }

    override fun recordTrustedIds(
        scope: String,
        bucket: ReminderCacheBucket,
        itemIds: Set<String>,
    ) {
        synchronized(lock) {
            preferences.edit {
                putString(cacheScopeKey(bucket), scope)
                putStringSet(cacheIdsKey(bucket), itemIds)
            }
        }
    }

    override fun trustedIds(scope: String, bucket: ReminderCacheBucket): Set<String>? =
        synchronized(lock) {
            if (preferences.getString(cacheScopeKey(bucket), null) != scope) {
                return@synchronized null
            }
            preferences.getStringSet(cacheIdsKey(bucket), emptySet())?.toSet() ?: emptySet()
        }

    private companion object {
        const val PREFERENCES_NAME = "clawchat_reminder_deliveries"
        const val MAX_ENTRY_AGE_MILLIS = 35L * 24 * 60 * 60 * 1_000
        val lock = Any()

        fun cacheScopeKey(bucket: ReminderCacheBucket): String =
            "cache_scope:${bucket.storageKey}"

        fun cacheIdsKey(bucket: ReminderCacheBucket): String =
            "cache_ids:${bucket.storageKey}"
    }
}

/** Atomic claim abstraction used by the recovery engine and its tests. */
interface ReminderClaimStore {
    fun claim(key: String, claimedAtMillis: Long, suppressForMillis: Long): Boolean
    fun release(key: String, claimedAtMillis: Long)
}

/** Provenance for Room snapshots used by the background recovery path. */
internal interface ReminderCacheTrustStore {
    fun recordTrustedIds(scope: String, bucket: ReminderCacheBucket, itemIds: Set<String>)
    fun trustedIds(scope: String, bucket: ReminderCacheBucket): Set<String>?
}

internal enum class ReminderCacheBucket(val storageKey: String) {
    TODOS("todos"),
    EVENTS("events"),
}

internal const val RECENT_REMINDER_WINDOW_MILLIS = 30L * 60 * 1_000
internal const val EXACT_REMINDER_WINDOW_MILLIS = 30L * 24 * 60 * 60 * 1_000

internal fun reminderTypeFamily(reminderType: String): String = when (reminderType) {
    "todo", "todo_overdue" -> "todo"
    else -> reminderType
}

internal fun recentReminderKey(reminderType: String, itemId: String): String =
    "recent:${reminderTypeFamily(reminderType)}:$itemId"

/**
 * Stable cross-channel identity. Epoch seconds intentionally match the
 * backend's precision even when a database timestamp contains microseconds.
 */
internal fun reminderDeliveryKey(
    reminderType: String,
    occurrenceIdentity: String,
    scheduledAtEpochSecond: Long,
): String =
    "delivery:v2:${reminderTypeFamily(reminderType)}:$occurrenceIdentity:$scheduledAtEpochSecond"
