package com.clawchat.android.core.update

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** User-owned updater preferences: automatic checks, throttling, skipped release. */
@Singleton
class UpdatePreferences @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    companion object {
        private val KEY_AUTO_CHECK = booleanPreferencesKey("update_auto_check")
        private val KEY_LAST_CHECKED_AT = longPreferencesKey("update_last_checked_at")
        private val KEY_SKIPPED_VERSION = stringPreferencesKey("update_skipped_version")
    }

    val autoCheckEnabled: Flow<Boolean> = dataStore.data.map { it[KEY_AUTO_CHECK] ?: true }
    val lastCheckedAt: Flow<Long> = dataStore.data.map { it[KEY_LAST_CHECKED_AT] ?: 0L }
    val skippedVersion: Flow<String?> = dataStore.data.map { it[KEY_SKIPPED_VERSION] }

    suspend fun isAutoCheckEnabled(): Boolean = autoCheckEnabled.first()

    suspend fun setAutoCheckEnabled(enabled: Boolean) {
        dataStore.edit { it[KEY_AUTO_CHECK] = enabled }
    }

    suspend fun lastCheckedAtMillis(): Long = lastCheckedAt.first()

    suspend fun recordCheckedAt(millis: Long) {
        dataStore.edit { it[KEY_LAST_CHECKED_AT] = millis }
    }

    suspend fun skippedVersion(): String? = skippedVersion.first()

    suspend fun skipVersion(version: String) {
        dataStore.edit { it[KEY_SKIPPED_VERSION] = version }
    }

    suspend fun clearSkippedVersion() {
        dataStore.edit { it.remove(KEY_SKIPPED_VERSION) }
    }
}
