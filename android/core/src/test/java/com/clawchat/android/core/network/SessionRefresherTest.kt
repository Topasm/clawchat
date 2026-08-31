package com.clawchat.android.core.network

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.clawchat.android.core.api.PairingApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.LoginResponse
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class SessionRefresherTest {

    @Test
    fun `expired manual session rotates without asking for the PIN`() = runTest {
        val store = SessionStore(newDataStore(this))
        val pairingApi = mockk<PairingApi>()
        store.saveManualSession(
            accessToken = "expired-access",
            refreshToken = "remembered-refresh",
            apiBaseUrl = "https://workspace.example",
        )
        coEvery { pairingApi.refresh(any(), any()) } returns LoginResponse(
            accessToken = "fresh-access",
            refreshToken = "fresh-refresh",
            tokenType = "bearer",
            expiresIn = 86_400,
        )

        val refreshed = SessionRefresher(store, pairingApi)
            .refreshAfterUnauthorized("expired-access")

        assertEquals("fresh-access", refreshed)
        assertEquals("fresh-access", store.token.first())
        assertEquals("fresh-refresh", store.refreshToken.first())
        coVerify(exactly = 1) {
            pairingApi.refresh("https://workspace.example/api/auth/refresh", any())
        }
    }

    private fun newDataStore(scope: TestScope): DataStore<Preferences> {
        val file = File.createTempFile("session-refresh-test", ".preferences_pb").apply {
            deleteOnExit()
        }
        return PreferenceDataStoreFactory.create(
            scope = scope.backgroundScope,
            produceFile = { file },
        )
    }
}
