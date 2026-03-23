package com.clawchat.android.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Stores session data (device token, server URL, device ID) in
 * DataStore Preferences. This is the single source of truth for
 * the app's connection state.
 */
@Singleton
class SessionStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    companion object {
        private val KEY_TOKEN = stringPreferencesKey("device_token")
        private val KEY_API_BASE_URL = stringPreferencesKey("api_base_url")
        private val KEY_DEVICE_ID = stringPreferencesKey("device_id")
        private val KEY_HOST_NAME = stringPreferencesKey("host_name")
        private val KEY_AUTH_MODE = stringPreferencesKey("auth_mode") // "paired" | "manual"
        private val KEY_ONBOARDING_SKIPPED = booleanPreferencesKey("onboarding_skipped")
        private val KEY_ACCENT_COLOR = stringPreferencesKey("accent_color")
        private val KEY_THEME_MODE = stringPreferencesKey("theme_mode")
    }

    val token: Flow<String?> = dataStore.data.map { it[KEY_TOKEN] }
    val apiBaseUrl: Flow<String?> = dataStore.data.map { it[KEY_API_BASE_URL] }
    val deviceId: Flow<String?> = dataStore.data.map { it[KEY_DEVICE_ID] }
    val hostName: Flow<String?> = dataStore.data.map { it[KEY_HOST_NAME] }
    val authMode: Flow<String?> = dataStore.data.map { it[KEY_AUTH_MODE] }
    val isLoggedIn: Flow<Boolean> = dataStore.data.map { it[KEY_TOKEN] != null }
    val onboardingSkipped: Flow<Boolean> = dataStore.data.map { it[KEY_ONBOARDING_SKIPPED] == true }
    val accentColor: Flow<String> = dataStore.data.map { it[KEY_ACCENT_COLOR] ?: "system" }
    val themeMode: Flow<String> = dataStore.data.map { it[KEY_THEME_MODE] ?: "light" }

    /** Save session after successful pairing. */
    suspend fun savePairedSession(
        deviceId: String,
        deviceToken: String,
        apiBaseUrl: String,
        hostName: String,
    ) {
        dataStore.edit { prefs ->
            prefs[KEY_DEVICE_ID] = deviceId
            prefs[KEY_TOKEN] = deviceToken
            prefs[KEY_API_BASE_URL] = apiBaseUrl
            prefs[KEY_HOST_NAME] = hostName
            prefs[KEY_AUTH_MODE] = "paired"
        }
    }

    /** Save session after manual login (URL + PIN). */
    suspend fun saveManualSession(
        accessToken: String,
        apiBaseUrl: String,
    ) {
        dataStore.edit { prefs ->
            prefs[KEY_TOKEN] = accessToken
            prefs[KEY_API_BASE_URL] = apiBaseUrl
            prefs[KEY_AUTH_MODE] = "manual"
        }
    }

    /** Mark onboarding as skipped (set up server later). */
    suspend fun markOnboardingSkipped() {
        dataStore.edit { prefs ->
            prefs[KEY_ONBOARDING_SKIPPED] = true
        }
    }

    /** Set accent color preference. */
    suspend fun setAccentColor(key: String) {
        dataStore.edit { prefs -> prefs[KEY_ACCENT_COLOR] = key }
    }

    /** Set theme mode preference. */
    suspend fun setThemeMode(key: String) {
        dataStore.edit { prefs -> prefs[KEY_THEME_MODE] = key }
    }

    /** Clear session data (logout). Preserves user preferences like accent color and theme mode. */
    suspend fun clearSession() {
        dataStore.edit { prefs ->
            prefs.remove(KEY_TOKEN)
            prefs.remove(KEY_API_BASE_URL)
            prefs.remove(KEY_DEVICE_ID)
            prefs.remove(KEY_HOST_NAME)
            prefs.remove(KEY_AUTH_MODE)
            prefs.remove(KEY_ONBOARDING_SKIPPED)
        }
    }
}
