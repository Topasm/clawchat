package com.clawchat.android.feature.settings

import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.DeviceListResponse
import com.clawchat.android.core.data.model.HealthResponse
import com.clawchat.android.core.data.repository.DeviceRepository
import com.clawchat.android.core.data.repository.SettingsRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.update.AppUpdateManager
import com.clawchat.android.core.update.UpdateState
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private val settingsRepository = mockk<SettingsRepository>()
    private val deviceRepository = mockk<DeviceRepository>()
    private val sessionStore = mockk<SessionStore>(relaxed = true)
    private val updateManager = mockk<AppUpdateManager>(relaxed = true)
    private val syncManager = mockk<SyncManager>()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        every { updateManager.state } returns MutableStateFlow(UpdateState())
        every { sessionStore.apiBaseUrl } returns flowOf("https://demo.clawchat.app/api?token=hidden")
        every { sessionStore.relayUrl } returns flowOf(null)
        every { sessionStore.token } returns flowOf("device-token")
        every { syncManager.isConnected } returns MutableStateFlow(true)
        every { syncManager.lastEventAtEpochMillis } returns MutableStateFlow(1_700_000_000_000L)
        every { syncManager.lastConnectionError } returns MutableStateFlow(null)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `load populates theme mode and connection state`() = runTest {
        every { sessionStore.hostName } returns flowOf("demo.clawchat.app")
        every { sessionStore.authMode } returns flowOf("paired")
        every { sessionStore.accentColor } returns flowOf("blue")
        every { sessionStore.themeMode } returns flowOf("dark")
        coEvery { settingsRepository.health() } returns ApiResult.Success(
            HealthResponse(
                status = "ok",
                version = "1.0.0",
                aiProvider = "openai",
                aiModel = "gpt-5.4",
                aiConnected = true,
            ),
        )
        coEvery { deviceRepository.listDevices() } returns ApiResult.Success(DeviceListResponse(emptyList()))

        val viewModel = SettingsViewModel(
            settingsRepository,
            deviceRepository,
            sessionStore,
            updateManager,
            syncManager,
        )
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("demo.clawchat.app", state.hostName)
        assertEquals("paired", state.authMode)
        assertEquals("blue", state.accentColor)
        assertEquals("dark", state.themeMode)
        assertEquals("1.0.0", state.health?.version)
        assertEquals("https://demo.clawchat.app", state.diagnostics?.serverOrigin)
        assertEquals(true, state.diagnostics?.httpReachable)
        assertEquals(true, state.diagnostics?.realtimeConnected)
        assertTrue(state.devices.isEmpty())
        assertEquals(false, state.isLoading)
    }

    @Test
    fun `setThemeMode persists preference and updates ui state`() = runTest {
        every { sessionStore.hostName } returns flowOf("")
        every { sessionStore.authMode } returns flowOf("")
        every { sessionStore.accentColor } returns flowOf("system")
        every { sessionStore.themeMode } returns flowOf("light")
        coEvery { settingsRepository.health() } returns ApiResult.Error("offline")
        coEvery { deviceRepository.listDevices() } returns ApiResult.Error("offline")
        coEvery { sessionStore.setThemeMode("system") } returns Unit

        val viewModel = SettingsViewModel(
            settingsRepository,
            deviceRepository,
            sessionStore,
            updateManager,
            syncManager,
        )
        advanceUntilIdle()

        viewModel.setThemeMode("system")
        advanceUntilIdle()

        assertEquals("system", viewModel.uiState.value.themeMode)
        coVerify(exactly = 1) { sessionStore.setThemeMode("system") }
    }

    @Test
    fun `connection check does not probe the placeholder without a configured server`() = runTest {
        every { sessionStore.hostName } returns flowOf("")
        every { sessionStore.authMode } returns flowOf("")
        every { sessionStore.accentColor } returns flowOf("system")
        every { sessionStore.themeMode } returns flowOf("light")
        every { sessionStore.apiBaseUrl } returns flowOf(null)
        every { sessionStore.token } returns flowOf(null)
        coEvery { deviceRepository.listDevices() } returns ApiResult.Error("not connected")

        val viewModel = SettingsViewModel(
            settingsRepository,
            deviceRepository,
            sessionStore,
            updateManager,
            syncManager,
        )
        advanceUntilIdle()

        coVerify(exactly = 0) { settingsRepository.health() }
        coVerify(exactly = 0) { deviceRepository.listDevices() }
        assertEquals("Not configured", viewModel.uiState.value.diagnostics?.serverOrigin)
        assertEquals(false, viewModel.uiState.value.diagnostics?.httpReachable)
        assertNull(viewModel.uiState.value.diagnostics?.latencyMillis)
    }
}
