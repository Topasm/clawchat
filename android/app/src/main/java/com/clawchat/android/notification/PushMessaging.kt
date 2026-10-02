package com.clawchat.android.notification

import android.content.Context
import android.util.Log
import com.clawchat.android.BuildConfig
import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.RegisterPushTokenRequest
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "PushMessaging"

/**
 * Firebase Cloud Messaging, configured from Gradle properties instead of a
 * `google-services.json`: `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`,
 * `FIREBASE_API_KEY` and `FIREBASE_SENDER_ID` (see `android/gradle.properties`).
 * Without them the app builds and runs exactly as before, with no push.
 */
object PushConfig {
    val enabled: Boolean
        get() = BuildConfig.FIREBASE_APP_ID.isNotBlank() &&
            BuildConfig.FIREBASE_API_KEY.isNotBlank() &&
            BuildConfig.FIREBASE_PROJECT_ID.isNotBlank()

    /** Returns true when Firebase is ready to hand out a token. */
    fun initialize(context: Context): Boolean {
        if (!enabled) return false
        return try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                val options = FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .apply {
                        if (BuildConfig.FIREBASE_SENDER_ID.isNotBlank()) {
                            setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                        }
                    }
                    .build()
                FirebaseApp.initializeApp(context, options)
            }
            true
        } catch (e: Exception) {
            Log.w(TAG, "Firebase could not be initialized; push stays off", e)
            false
        }
    }
}

/**
 * Hands the device's FCM token to the server it is paired with.
 *
 * The token is tied to this install, the registration to a workspace: it is
 * sent again whenever the token rotates or the user pairs with a (different)
 * server, and never while the app runs in local mode.
 */
@Singleton
class PushTokenRegistrar @Inject constructor(
    private val api: ClawChatApi,
    private val sessionStore: SessionStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var latestToken: String? = null

    /** The (workspace, token) pair the server last accepted. */
    @Volatile private var registered: Pair<String, String>? = null

    fun start() {
        if (!PushConfig.enabled) return
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token -> submit(token) }
            .addOnFailureListener { error -> Log.w(TAG, "FCM token unavailable", error) }
        scope.launch {
            sessionStore.runtimeState
                .map { state ->
                    state.workspaceKey?.takeIf {
                        state.mode == WorkspaceMode.SERVER && state.activeSession != null
                    }
                }
                .distinctUntilChanged()
                .collect { workspaceKey ->
                    if (workspaceKey != null) latestToken?.let { register(it) }
                }
        }
    }

    fun submit(token: String) {
        latestToken = token
        scope.launch { register(token) }
    }

    private suspend fun register(token: String) {
        val state = sessionStore.runtimeState.first()
        val workspaceKey = state.workspaceKey ?: return
        if (state.mode != WorkspaceMode.SERVER || state.activeSession == null) return
        if (registered == workspaceKey to token) return
        try {
            val response = api.registerPushToken(RegisterPushTokenRequest(token))
            if (response.status == "registered") {
                registered = workspaceKey to token
                Log.i(TAG, "Push token registered for device ${response.deviceId}")
            } else {
                Log.w(TAG, "Push token not registered: ${response.reason}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Push token registration failed", e)
        }
    }
}
