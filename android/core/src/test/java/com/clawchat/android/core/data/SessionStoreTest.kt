package com.clawchat.android.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
            apiBaseUrl = "http://localhost:8000",
        )

        store.clearSession()

        assertNull(store.token.first())
        assertEquals("blue", store.accentColor.first())
        assertEquals("dark", store.themeMode.first())
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
