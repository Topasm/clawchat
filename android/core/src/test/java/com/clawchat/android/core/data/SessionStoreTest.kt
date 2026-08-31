package com.clawchat.android.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SessionStoreTest {

    @Test
    fun `a fresh install is unconfigured`() = runTest {
        val store = SessionStore(newDataStore(this))

        assertEquals(WorkspaceMode.UNCONFIGURED, store.runtimeState.first().mode)
        assertNull(store.runtimeState.first().activeSession)
        assertEquals(false, store.runtimeState.first().hasSavedServerSession)
        assertNull(store.runtimeState.first().workspaceKey)
    }

    @Test
    fun `theme mode defaults to light`() = runTest {
        val store = SessionStore(newDataStore(this))

        assertEquals("light", store.themeMode.first())
    }

    @Test
    fun `clear session preserves appearance preferences`() = runTest {
        val store = SessionStore(newDataStore(this))

        store.setAccentColor("blue")
        store.setThemeMode("dark")
        store.saveManualSession(
            accessToken = "token",
            refreshToken = "refresh-token",
            apiBaseUrl = "http://localhost:8000",
        )

        store.clearSession()

        assertNull(store.token.first())
        assertNull(store.refreshToken.first())
        assertEquals("blue", store.accentColor.first())
        assertEquals("dark", store.themeMode.first())
    }

    @Test
    fun `manual login remembers both tokens for automatic renewal`() = runTest {
        val store = SessionStore(newDataStore(this))

        store.saveManualSession(
            accessToken = "access-token",
            refreshToken = "refresh-token",
            apiBaseUrl = "https://workspace.example",
        )

        assertEquals("access-token", store.token.first())
        assertEquals("refresh-token", store.refreshToken.first())
        assertEquals("https://workspace.example", store.apiBaseUrl.first())
        assertEquals(WorkspaceMode.SERVER, store.runtimeState.first().mode)
        assertTrue(store.runtimeState.first().workspaceKey?.startsWith("server:url:") == true)
        assertFalse(store.runtimeState.first().workspaceKey.orEmpty().contains("workspace.example"))
    }

    @Test
    fun `manual login replaces paired host identity and workspace scope`() = runTest {
        val store = SessionStore(newDataStore(this))
        store.savePairedSession(
            deviceId = "device-a",
            deviceToken = "paired-token",
            apiBaseUrl = "https://paired.example",
            hostName = "Paired host",
            hostId = "host-a",
            hostPublicKey = "public-key",
            relayUrl = "https://relay.example",
        )
        val pairedState = store.runtimeState.first()
        assertEquals("server:host:host-a", pairedState.workspaceKey)
        assertEquals("https://relay.example", pairedState.activeSession?.relayUrl)
        assertEquals("public-key", pairedState.activeSession?.hostPublicKey)

        store.saveManualSession("manual-token", "refresh", "https://manual.example")

        assertNull(store.hostId.first())
        assertNull(store.hostName.first())
        assertNull(store.relayUrl.first())
        assertNull(store.activeSession.first()?.relayUrl)
        assertNull(store.activeSession.first()?.hostPublicKey)
        assertTrue(store.runtimeState.first().workspaceKey?.startsWith("server:url:") == true)
        assertFalse(store.runtimeState.first().workspaceKey.orEmpty().contains("manual.example"))
    }

    @Test
    fun `local mode persists while hiding a remembered server session`() = runTest {
        val dataStore = newDataStore(this)
        val store = SessionStore(dataStore)
        store.saveManualSession("access", "refresh", "https://workspace.example")

        store.selectLocalMode()

        val state = store.runtimeState.first()
        assertEquals(WorkspaceMode.LOCAL, state.mode)
        assertNull(state.activeSession)
        assertTrue(state.hasSavedServerSession)
        assertEquals("local", state.workspaceKey)
        assertEquals("access", store.token.first())
        assertFalse(store.isLoggedIn.first())
        assertTrue(store.onboardingSkipped.first())
        assertEquals(WorkspaceMode.LOCAL, SessionStore(dataStore).runtimeState.first().mode)
    }

    @Test
    fun `a saved server can be reactivated without another login`() = runTest {
        val store = SessionStore(newDataStore(this))
        store.saveManualSession("access", "refresh", "https://workspace.example")
        store.selectLocalMode()

        assertTrue(store.activateSavedServer())

        assertEquals(WorkspaceMode.SERVER, store.runtimeState.first().mode)
        assertEquals("access", store.activeSession.first()?.token)
        assertTrue(store.isLoggedIn.first())
        assertFalse(store.onboardingSkipped.first())
    }

    @Test
    fun `paired relay context is hidden locally and restored atomically`() = runTest {
        val store = SessionStore(newDataStore(this))
        store.savePairedSession(
            deviceId = "device-a",
            deviceToken = "paired-token",
            apiBaseUrl = "https://paired.example",
            hostName = "Paired host",
            hostId = "host-a",
            hostPublicKey = "public-key",
            relayUrl = "https://relay.example",
        )

        store.selectLocalMode()

        assertNull(store.activeSession.first())
        assertTrue(store.activateSavedServer())
        assertEquals(
            ActiveSession(
                token = "paired-token",
                apiBaseUrl = "https://paired.example",
                hostId = "host-a",
                authMode = "paired",
                relayUrl = "https://relay.example",
                hostPublicKey = "public-key",
            ),
            store.activeSession.first(),
        )
    }

    @Test
    fun `activating a missing server leaves setup unconfigured`() = runTest {
        val store = SessionStore(newDataStore(this))

        assertFalse(store.activateSavedServer())

        assertEquals(WorkspaceMode.UNCONFIGURED, store.runtimeState.first().mode)
    }

    @Test
    fun `forgetting a server clears credentials and remains local`() = runTest {
        val store = SessionStore(newDataStore(this))
        store.saveManualSession("access", "refresh", "https://workspace.example")

        store.forgetSavedServer()

        val state = store.runtimeState.first()
        assertEquals(WorkspaceMode.LOCAL, state.mode)
        assertFalse(state.hasSavedServerSession)
        assertNull(state.activeSession)
        assertNull(store.token.first())
        assertNull(store.refreshToken.first())
        assertNull(store.apiBaseUrl.first())
    }

    @Test
    fun `legacy session takes precedence over legacy onboarding skip`() = runTest {
        val dataStore = newDataStore(this)
        dataStore.edit { preferences ->
            preferences[stringPreferencesKey("device_token")] = "legacy-token"
            preferences[stringPreferencesKey("api_base_url")] = "https://legacy.example"
            preferences[stringPreferencesKey("auth_mode")] = "paired"
            preferences[booleanPreferencesKey("onboarding_skipped")] = true
        }

        val state = SessionStore(dataStore).runtimeState.first()

        assertEquals(WorkspaceMode.SERVER, state.mode)
        assertEquals("legacy-token", state.activeSession?.token)
    }

    @Test
    fun `legacy onboarding skip becomes explicit local runtime state`() = runTest {
        val dataStore = newDataStore(this)
        dataStore.edit { preferences ->
            preferences[booleanPreferencesKey("onboarding_skipped")] = true
        }

        val state = SessionStore(dataStore).runtimeState.first()

        assertEquals(WorkspaceMode.LOCAL, state.mode)
        assertEquals("local", state.workspaceKey)
    }

    @Test
    fun `a stale refresh cannot overwrite a newer workspace session`() = runTest {
        val store = SessionStore(newDataStore(this))
        store.saveManualSession("access-a", "refresh-a", "https://a.example")
        store.saveManualSession("access-b", "refresh-b", "https://b.example")

        val rotated = store.rotateManualSession(
            expectedAccessToken = "access-a",
            expectedRefreshToken = "refresh-a",
            expectedApiBaseUrl = "https://a.example",
            accessToken = "late-access-a",
            refreshToken = "late-refresh-a",
        )

        assertFalse(rotated)
        assertEquals("access-b", store.token.first())
        assertEquals("https://b.example", store.apiBaseUrl.first())
    }

    @Test
    fun `late authentication work cannot mutate a server saved behind local mode`() = runTest {
        val store = SessionStore(newDataStore(this))
        store.saveManualSession("access", "refresh", "https://workspace.example")
        store.selectLocalMode()

        assertFalse(
            store.rotateManualSession(
                expectedAccessToken = "access",
                expectedRefreshToken = "refresh",
                expectedApiBaseUrl = "https://workspace.example",
                accessToken = "late-access",
                refreshToken = "late-refresh",
            ),
        )
        assertFalse(store.clearSessionIfToken("access"))
        assertTrue(store.activateSavedServer())
        assertEquals("access", store.activeSession.first()?.token)
        assertEquals("refresh", store.activeSession.first()?.refreshToken)
    }

    @Test
    fun `stale unauthorized response cannot clear a newer workspace session`() = runTest {
        val store = SessionStore(newDataStore(this))
        store.saveManualSession("access-a", "refresh-a", "https://a.example")
        store.saveManualSession("access-b", "refresh-b", "https://b.example")

        assertEquals(false, store.clearSessionIfToken("access-a"))
        assertEquals("access-b", store.activeSession.first()?.token)

        assertEquals(true, store.clearSessionIfToken("access-b"))
        assertEquals(null, store.activeSession.first())
    }

    @Test
    fun `the current manual session rotates atomically`() = runTest {
        val store = SessionStore(newDataStore(this))
        store.saveManualSession("access", "refresh", "https://workspace.example/")

        val rotated = store.rotateManualSession(
            expectedAccessToken = "access",
            expectedRefreshToken = "refresh",
            expectedApiBaseUrl = "https://workspace.example",
            accessToken = "fresh-access",
            refreshToken = "fresh-refresh",
        )

        assertTrue(rotated)
        assertEquals("fresh-access", store.token.first())
        assertEquals("fresh-refresh", store.refreshToken.first())
    }

    @Test
    fun `the notification permission prompt is only remembered once asked`() = runTest {
        val store = SessionStore(newDataStore(this))

        assertEquals(false, store.notificationPermissionRequested.first())

        store.markNotificationPermissionRequested()

        assertEquals(true, store.notificationPermissionRequested.first())
    }

    private fun newDataStore(scope: TestScope): DataStore<Preferences> {
        val file = File.createTempFile("session-store-test", ".preferences_pb").apply {
            deleteOnExit()
        }
        return PreferenceDataStoreFactory.create(
            scope = scope.backgroundScope,
            produceFile = { file },
        )
    }
}
