package com.clawchat.android.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
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
