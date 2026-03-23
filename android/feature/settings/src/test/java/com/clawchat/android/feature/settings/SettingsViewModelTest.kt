package com.clawchat.android.feature.settings

import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.DeviceListResponse
import com.clawchat.android.core.data.model.HealthResponse
import com.clawchat.android.core.data.repository.DeviceRepository
import com.clawchat.android.core.data.repository.SettingsRepository
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private val settingsRepository = mockk<SettingsRepository>()
    private val deviceRepository = mockk<DeviceRepository>()
    private val sessionStore = mockk<SessionStore>(relaxed = true)

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
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

        val viewModel = SettingsViewModel(settingsRepository, deviceRepository, sessionStore)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("demo.clawchat.app", state.hostName)
        assertEquals("paired", state.authMode)
        assertEquals("blue", state.accentColor)
        assertEquals("dark", state.themeMode)
        assertEquals("1.0.0", state.health?.version)
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

        val viewModel = SettingsViewModel(settingsRepository, deviceRepository, sessionStore)
        advanceUntilIdle()

        viewModel.setThemeMode("system")
        advanceUntilIdle()

        assertEquals("system", viewModel.uiState.value.themeMode)
        coVerify(exactly = 1) { sessionStore.setThemeMode("system") }
    }
}
