package com.clawchat.android.feature.onboarding

import com.clawchat.android.core.api.PairingApi
import com.clawchat.android.core.data.SessionStore
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class OnboardingViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private val pairingApi = mockk<PairingApi>()
    private val sessionStore = mockk<SessionStore>()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `local choice is persisted before onboarding completes`() = runTest {
        var persisted = false
        var completed = false
        coEvery { sessionStore.selectLocalMode() } coAnswers {
            assertFalse(completed)
            persisted = true
        }
        val viewModel = viewModel()

        viewModel.useLocalMode {
            assertTrue(persisted)
            completed = true
        }
        assertTrue(viewModel.uiState.value.isSelectingLocalMode)
        assertFalse(completed)

        advanceUntilIdle()

        assertTrue(completed)
        assertFalse(viewModel.uiState.value.isSelectingLocalMode)
        assertEquals(null, viewModel.uiState.value.error)
        coVerify(exactly = 1) { sessionStore.selectLocalMode() }
    }

    @Test
    fun `a failed local choice stays in onboarding and can be retried`() = runTest {
        var completed = false
        coEvery { sessionStore.selectLocalMode() } throws IllegalStateException("storage unavailable")
        val viewModel = viewModel()

        viewModel.useLocalMode { completed = true }
        advanceUntilIdle()

        assertFalse(completed)
        assertFalse(viewModel.uiState.value.isSelectingLocalMode)
        assertEquals(OnboardingError.LOCAL_MODE_FAILED, viewModel.uiState.value.error)
    }

    @Test
    fun `repeated local taps persist one transition`() = runTest {
        coEvery { sessionStore.selectLocalMode() } returns Unit
        val viewModel = viewModel()
        var completionCount = 0

        viewModel.useLocalMode { completionCount++ }
        viewModel.useLocalMode { completionCount++ }
        advanceUntilIdle()

        assertEquals(1, completionCount)
        coVerify(exactly = 1) { sessionStore.selectLocalMode() }
    }

    @Test
    fun `pairing QR parser accepts a complete server payload`() {
        val payload = parsePairingQrPayload(
            """{"type":"clawchat_pair","server_url":"https://clawchat.local","code":"123456","host_id":"host-1","host_public_key":"key-1"}""",
        )

        assertEquals("https://clawchat.local", payload?.serverUrl)
        assertEquals("123456", payload?.code)
        assertEquals("host-1", payload?.hostId)
        assertEquals("key-1", payload?.hostPublicKey)
    }

    @Test
    fun `pairing QR parser rejects unrelated and malformed codes`() {
        assertEquals(null, parsePairingQrPayload("not json"))
        assertEquals(
            null,
            parsePairingQrPayload(
                """{"type":"website","server_url":"https://clawchat.local","code":"123456"}""",
            ),
        )
        assertEquals(
            null,
            parsePairingQrPayload(
                """{"type":"clawchat_pair","server_url":"https://clawchat.local","code":"12345x"}""",
            ),
        )
    }

    private fun viewModel() = OnboardingViewModel(
        pairingApi = pairingApi,
        sessionStore = sessionStore,
        debugServerUrl = "",
    )
}
