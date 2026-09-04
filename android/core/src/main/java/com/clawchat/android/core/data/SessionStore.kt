package com.clawchat.android.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/** One atomic view of the connection fields needed by background work. */
data class ActiveSession(
    val token: String,
    val apiBaseUrl: String?,
    val hostId: String?,
    val authMode: String?,
    val refreshToken: String? = null,
    /** Paired-host relay fields captured from the same DataStore snapshot. */
    val relayUrl: String? = null,
    val hostPublicKey: String? = null,
)

/** Selects where the Android client reads and writes workspace data. */
enum class WorkspaceMode {
    /** The user has not chosen local storage or connected a server yet. */
    UNCONFIGURED,

    /** This device is the workspace; no ClawChat server connection is active. */
    LOCAL,

    /** A remembered ClawChat server session is active. */
    SERVER,
    ;

    internal val persistedValue: String
        get() = name.lowercase()

    internal companion object {
        fun fromPersisted(value: String?): WorkspaceMode? = when (value) {
            LOCAL.persistedValue -> LOCAL
            SERVER.persistedValue -> SERVER
            else -> null
        }
    }
}

/**
 * One atomic snapshot of the mode and server session used by app lifecycle,
 * navigation, repositories, widgets, and background work.
 */
data class AppRuntimeState(
    val mode: WorkspaceMode,
    val activeSession: ActiveSession?,
    val hasSavedServerSession: Boolean,
    /** Stable, credential-free identity used to scope Room data and UI state. */
    val workspaceKey: String?,
)

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
        private const val LOCAL_WORKSPACE_KEY = "local"
        private val KEY_TOKEN = stringPreferencesKey("device_token")
        private val KEY_REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        private val KEY_API_BASE_URL = stringPreferencesKey("api_base_url")
        private val KEY_DEVICE_ID = stringPreferencesKey("device_id")
        private val KEY_HOST_NAME = stringPreferencesKey("host_name")
        private val KEY_HOST_ID = stringPreferencesKey("host_id")
        private val KEY_HOST_PUBLIC_KEY = stringPreferencesKey("host_public_key")
        private val KEY_RELAY_URL = stringPreferencesKey("relay_url")
        private val KEY_AUTH_MODE = stringPreferencesKey("auth_mode") // "paired" | "manual"
        private val KEY_WORKSPACE_MODE = stringPreferencesKey("workspace_mode")
        private val KEY_ONBOARDING_SKIPPED = booleanPreferencesKey("onboarding_skipped")
        private val KEY_ACCENT_COLOR = stringPreferencesKey("accent_color")
        private val KEY_THEME_MODE = stringPreferencesKey("theme_mode")
        private val KEY_NOTIFICATION_PERMISSION_REQUESTED =
            booleanPreferencesKey("notification_permission_requested")
    }

    val token: Flow<String?> = dataStore.data.map { it[KEY_TOKEN] }
    val refreshToken: Flow<String?> = dataStore.data.map { it[KEY_REFRESH_TOKEN] }
    val apiBaseUrl: Flow<String?> = dataStore.data.map { it[KEY_API_BASE_URL] }
    val deviceId: Flow<String?> = dataStore.data.map { it[KEY_DEVICE_ID] }
    val hostName: Flow<String?> = dataStore.data.map { it[KEY_HOST_NAME] }
    val hostId: Flow<String?> = dataStore.data.map { it[KEY_HOST_ID] }
    val hostPublicKey: Flow<String?> = dataStore.data.map { it[KEY_HOST_PUBLIC_KEY] }
    val relayUrl: Flow<String?> = dataStore.data.map { it[KEY_RELAY_URL] }
    val authMode: Flow<String?> = dataStore.data.map { it[KEY_AUTH_MODE] }

    /**
     * The explicit mode is preferred. Legacy installs are interpreted without
     * a destructive migration: a complete remembered session means SERVER,
     * while the old onboarding-skipped flag means LOCAL.
     */
    val runtimeState: Flow<AppRuntimeState> = dataStore.data
        .map(::runtimeStateFrom)
        .distinctUntilChanged()

    /** Compatibility views for callers that have not moved to [runtimeState]. */
    val activeSession: Flow<ActiveSession?> = runtimeState.map { it.activeSession }
    val isLoggedIn: Flow<Boolean> = runtimeState.map {
        it.mode == WorkspaceMode.SERVER && it.activeSession != null
    }
    val onboardingSkipped: Flow<Boolean> = runtimeState.map {
        it.mode == WorkspaceMode.LOCAL
    }
    val accentColor: Flow<String> = dataStore.data.map { it[KEY_ACCENT_COLOR] ?: "system" }
    val themeMode: Flow<String> = dataStore.data.map { it[KEY_THEME_MODE] ?: "light" }

    /**
     * Whether the app already asked for the notification permission. The system
     * silently denies a second request, so asking again would only be noise.
     */
    val notificationPermissionRequested: Flow<Boolean> =
        dataStore.data.map { it[KEY_NOTIFICATION_PERMISSION_REQUESTED] == true }

    /** Save session after successful pairing. */
    suspend fun savePairedSession(
        deviceId: String,
        deviceToken: String,
        apiBaseUrl: String,
        hostName: String,
        hostId: String,
        hostPublicKey: String,
        relayUrl: String?,
    ) {
        dataStore.edit { prefs ->
            prefs[KEY_DEVICE_ID] = deviceId
            prefs[KEY_TOKEN] = deviceToken
            prefs.remove(KEY_REFRESH_TOKEN)
            prefs[KEY_API_BASE_URL] = apiBaseUrl
            prefs[KEY_HOST_NAME] = hostName
            prefs[KEY_HOST_ID] = hostId
            prefs[KEY_HOST_PUBLIC_KEY] = hostPublicKey
            if (relayUrl != null) prefs[KEY_RELAY_URL] = relayUrl else prefs.remove(KEY_RELAY_URL)
            prefs[KEY_AUTH_MODE] = "paired"
            prefs[KEY_WORKSPACE_MODE] = WorkspaceMode.SERVER.persistedValue
            prefs.remove(KEY_ONBOARDING_SKIPPED)
        }
    }

    /** Save session after manual login (URL + PIN). */
    suspend fun saveManualSession(
        accessToken: String,
        refreshToken: String,
        apiBaseUrl: String,
    ) {
        dataStore.edit { prefs ->
            prefs[KEY_TOKEN] = accessToken
            prefs[KEY_REFRESH_TOKEN] = refreshToken
            prefs[KEY_API_BASE_URL] = apiBaseUrl
            prefs.remove(KEY_DEVICE_ID)
            prefs.remove(KEY_HOST_NAME)
            prefs.remove(KEY_HOST_ID)
            prefs.remove(KEY_HOST_PUBLIC_KEY)
            prefs.remove(KEY_RELAY_URL)
            prefs[KEY_AUTH_MODE] = "manual"
            prefs[KEY_WORKSPACE_MODE] = WorkspaceMode.SERVER.persistedValue
            prefs.remove(KEY_ONBOARDING_SKIPPED)
        }
    }

    /**
     * Use Room-backed local data without discarding a remembered server. The
     * saved token is deliberately hidden from [activeSession] in this mode, so
     * REST, WebSocket, relay, and background delivery cannot start.
     */
    suspend fun selectLocalMode() {
        dataStore.edit { prefs ->
            prefs[KEY_WORKSPACE_MODE] = WorkspaceMode.LOCAL.persistedValue
            // Keep old application versions on the same safe local path.
            prefs[KEY_ONBOARDING_SKIPPED] = true
        }
    }

    /** Reactivate the remembered server without asking for its PIN again. */
    suspend fun activateSavedServer(): Boolean {
        var activated = false
        dataStore.edit { prefs ->
            if (savedServerSessionFrom(prefs) != null) {
                prefs[KEY_WORKSPACE_MODE] = WorkspaceMode.SERVER.persistedValue
                prefs.remove(KEY_ONBOARDING_SKIPPED)
                activated = true
            }
        }
        return activated
    }

    /** Remove remembered server credentials and continue with the local workspace. */
    suspend fun forgetSavedServer() {
        dataStore.edit { prefs ->
            clearSavedServer(prefs)
            prefs[KEY_WORKSPACE_MODE] = WorkspaceMode.LOCAL.persistedValue
            prefs[KEY_ONBOARDING_SKIPPED] = true
        }
    }

    /**
     * Atomically rotate a manual session only if it is still the session that
     * received the 401. A slow refresh from workspace A must never overwrite a
     * newer login to workspace B.
     */
    suspend fun rotateManualSession(
        expectedAccessToken: String,
        expectedRefreshToken: String,
        expectedApiBaseUrl: String,
        accessToken: String,
        refreshToken: String,
    ): Boolean {
        var rotated = false
        dataStore.edit { prefs ->
            val sameSession = runtimeStateFrom(prefs).mode == WorkspaceMode.SERVER &&
                prefs[KEY_AUTH_MODE] == "manual" &&
                prefs[KEY_TOKEN] == expectedAccessToken &&
                prefs[KEY_REFRESH_TOKEN] == expectedRefreshToken &&
                prefs[KEY_API_BASE_URL]?.trimEnd('/') == expectedApiBaseUrl.trimEnd('/')
            if (sameSession) {
                prefs[KEY_TOKEN] = accessToken
                prefs[KEY_REFRESH_TOKEN] = refreshToken
                prefs[KEY_API_BASE_URL] = expectedApiBaseUrl.trimEnd('/')
                rotated = true
            }
        }
        return rotated
    }

    /**
     * Clear an unauthorized session only if it still owns [expectedAccessToken].
     * A failed refresh from workspace A must not log out a workspace B session
     * selected while that network request was in flight.
     */
    suspend fun clearSessionIfToken(expectedAccessToken: String): Boolean {
        var cleared = false
        dataStore.edit { prefs ->
            val runtimeState = runtimeStateFrom(prefs)
            if (
                runtimeState.mode == WorkspaceMode.SERVER &&
                runtimeState.activeSession?.token == expectedAccessToken
            ) {
                clearSavedServer(prefs)
                prefs.remove(KEY_WORKSPACE_MODE)
                prefs.remove(KEY_ONBOARDING_SKIPPED)
                cleared = true
            }
        }
        return cleared
    }

    /** Legacy name retained while older callers move to [selectLocalMode]. */
    suspend fun markOnboardingSkipped() {
        selectLocalMode()
    }

    /** Set accent color preference. */
    suspend fun setAccentColor(key: String) {
        dataStore.edit { prefs -> prefs[KEY_ACCENT_COLOR] = key }
    }

    /** Set theme mode preference. */
    suspend fun setThemeMode(key: String) {
        dataStore.edit { prefs -> prefs[KEY_THEME_MODE] = key }
    }

    /** Record that the notification permission prompt has been shown once. */
    suspend fun markNotificationPermissionRequested() {
        dataStore.edit { prefs -> prefs[KEY_NOTIFICATION_PERMISSION_REQUESTED] = true }
    }

    /** Clear session data (logout). Preserves user preferences like accent color and theme mode. */
    suspend fun clearSession() {
        dataStore.edit { prefs ->
            clearSavedServer(prefs)
            prefs.remove(KEY_WORKSPACE_MODE)
            prefs.remove(KEY_ONBOARDING_SKIPPED)
        }
    }

    private fun runtimeStateFrom(preferences: Preferences): AppRuntimeState {
        val savedSession = savedServerSessionFrom(preferences)
        val persistedMode = WorkspaceMode.fromPersisted(preferences[KEY_WORKSPACE_MODE])
        val mode = when {
            persistedMode == WorkspaceMode.LOCAL -> WorkspaceMode.LOCAL
            persistedMode == WorkspaceMode.SERVER && savedSession != null -> WorkspaceMode.SERVER
            persistedMode == WorkspaceMode.SERVER -> WorkspaceMode.UNCONFIGURED
            // Backward compatibility for releases before workspace_mode.
            savedSession != null -> WorkspaceMode.SERVER
            preferences[KEY_ONBOARDING_SKIPPED] == true -> WorkspaceMode.LOCAL
            else -> WorkspaceMode.UNCONFIGURED
        }
        val activeSession = savedSession.takeIf { mode == WorkspaceMode.SERVER }
        return AppRuntimeState(
            mode = mode,
            activeSession = activeSession,
            hasSavedServerSession = savedSession != null,
            workspaceKey = when (mode) {
                WorkspaceMode.UNCONFIGURED -> null
                WorkspaceMode.LOCAL -> LOCAL_WORKSPACE_KEY
                WorkspaceMode.SERVER -> activeSession?.workspaceKey()
            },
        )
    }

    private fun savedServerSessionFrom(preferences: Preferences): ActiveSession? {
        val token = preferences[KEY_TOKEN]?.takeIf(String::isNotBlank) ?: return null
        val apiBaseUrl = preferences[KEY_API_BASE_URL]?.takeIf(String::isNotBlank) ?: return null
        return ActiveSession(
            token = token,
            apiBaseUrl = apiBaseUrl,
            hostId = preferences[KEY_HOST_ID],
            authMode = preferences[KEY_AUTH_MODE],
            refreshToken = preferences[KEY_REFRESH_TOKEN],
            relayUrl = preferences[KEY_RELAY_URL],
            hostPublicKey = preferences[KEY_HOST_PUBLIC_KEY],
        )
    }

    private fun ActiveSession.workspaceKey(): String = if (authMode == "paired") {
        hostId
            ?.takeIf(String::isNotBlank)
            ?.let { "server:host:$it" }
            ?: requireNotNull(apiBaseUrl).serverUrlWorkspaceKey()
    } else {
        requireNotNull(apiBaseUrl).serverUrlWorkspaceKey()
    }

    /** Keep credentials, paths, and private hostnames out of persisted Room scopes. */
    private fun String.serverUrlWorkspaceKey(): String {
        val normalized = trim().trimEnd('/')
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(normalized.toByteArray(Charsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
        return "server:url:$digest"
    }

    private fun clearSavedServer(preferences: MutablePreferences) {
        preferences.remove(KEY_TOKEN)
        preferences.remove(KEY_REFRESH_TOKEN)
        preferences.remove(KEY_API_BASE_URL)
        preferences.remove(KEY_DEVICE_ID)
        preferences.remove(KEY_HOST_NAME)
        preferences.remove(KEY_HOST_ID)
        preferences.remove(KEY_HOST_PUBLIC_KEY)
        preferences.remove(KEY_RELAY_URL)
        preferences.remove(KEY_AUTH_MODE)
    }

}
