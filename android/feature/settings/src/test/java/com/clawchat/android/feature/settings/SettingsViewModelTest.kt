package com.clawchat.android.feature.settings

import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.DeviceListResponse
import com.clawchat.android.core.data.model.HealthResponse
import com.clawchat.android.core.data.model.TodaySuggestionList
import com.clawchat.android.core.data.repository.DeviceRepository
import com.clawchat.android.core.data.repository.SettingsRepository
import com.clawchat.android.core.data.repository.TodayRepository
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
import org.junit.Assert.assertFalse
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
    private val todayRepository = mockk<TodayRepository>()
    private val runtimeState = MutableStateFlow(serverRuntimeState())

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        every { updateManager.state } returns MutableStateFlow(UpdateState())
        runtimeState.value = serverRuntimeState()
        every { sessionStore.runtimeState } returns runtimeState
        every { sessionStore.apiBaseUrl } returns flowOf("https://demo.clawchat.app/api?token=hidden")
        every { sessionStore.relayUrl } returns flowOf(null)
        every { sessionStore.token } returns flowOf("device-token")
        every { syncManager.isConnected } returns MutableStateFlow(true)
        every { syncManager.lastEventAtEpochMillis } returns MutableStateFlow(1_700_000_000_000L)
        every { syncManager.lastConnectionError } returns MutableStateFlow(null)
        coEvery { todayRepository.getSuggestions() } returns ApiResult.Success(TodaySuggestionList(autoAdd = true))
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
            todayRepository,
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
            todayRepository,
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
        runtimeState.value = AppRuntimeState(
            mode = WorkspaceMode.UNCONFIGURED,
            activeSession = null,
            hasSavedServerSession = false,
            workspaceKey = null,
        )
        coEvery { deviceRepository.listDevices() } returns ApiResult.Error("not connected")

        val viewModel = SettingsViewModel(
            settingsRepository,
            deviceRepository,
            sessionStore,
            updateManager,
            syncManager,
            todayRepository,
        )
        advanceUntilIdle()

        coVerify(exactly = 0) { settingsRepository.health() }
        coVerify(exactly = 0) { deviceRepository.listDevices() }
        assertEquals(WorkspaceMode.UNCONFIGURED, viewModel.uiState.value.workspaceMode)
        assertNull(viewModel.uiState.value.diagnostics)
    }

    @Test
    fun `local mode never probes remembered server credentials`() = runTest {
        runtimeState.value = AppRuntimeState(
            mode = WorkspaceMode.LOCAL,
            activeSession = null,
            hasSavedServerSession = true,
            workspaceKey = "local",
        )
        every { sessionStore.hostName } returns flowOf("remembered.example")
        every { sessionStore.authMode } returns flowOf("paired")
        every { sessionStore.accentColor } returns flowOf("system")
        every { sessionStore.themeMode } returns flowOf("light")

        val viewModel = SettingsViewModel(
            settingsRepository,
            deviceRepository,
            sessionStore,
            updateManager,
            syncManager,
            todayRepository,
        )
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(WorkspaceMode.LOCAL, state.workspaceMode)
        assertEquals(true, state.hasSavedServerSession)
        assertEquals("", state.hostName)
        assertNull(state.health)
        assertNull(state.diagnostics)
        coVerify(exactly = 0) { settingsRepository.health() }
        coVerify(exactly = 0) { deviceRepository.listDevices() }
    }

    @Test
    fun `switching to local mode preserves the saved server and stops server settings`() = runTest {
        every { sessionStore.hostName } returns flowOf("demo.clawchat.app")
        every { sessionStore.authMode } returns flowOf("paired")
        every { sessionStore.accentColor } returns flowOf("system")
        every { sessionStore.themeMode } returns flowOf("light")
        coEvery { settingsRepository.health() } returns ApiResult.Error("offline")
        coEvery { deviceRepository.listDevices() } returns ApiResult.Error("offline")
        coEvery { sessionStore.selectLocalMode() } coAnswers {
            runtimeState.value = AppRuntimeState(
                mode = WorkspaceMode.LOCAL,
                activeSession = null,
                hasSavedServerSession = true,
                workspaceKey = "local",
            )
        }

        val viewModel = SettingsViewModel(
            settingsRepository,
            deviceRepository,
            sessionStore,
            updateManager,
            syncManager,
            todayRepository,
        )
        advanceUntilIdle()

        viewModel.switchToLocalMode()
        advanceUntilIdle()

        assertEquals(WorkspaceMode.LOCAL, viewModel.uiState.value.workspaceMode)
        assertEquals(true, viewModel.uiState.value.hasSavedServerSession)
        assertNull(viewModel.uiState.value.diagnostics)
        coVerify(exactly = 1) { sessionStore.selectLocalMode() }
    }

    @Test
    fun `a remembered server can be activated without setup`() = runTest {
        runtimeState.value = AppRuntimeState(
            mode = WorkspaceMode.LOCAL,
            activeSession = null,
            hasSavedServerSession = true,
            workspaceKey = "local",
        )
        every { sessionStore.hostName } returns flowOf("demo.clawchat.app")
        every { sessionStore.authMode } returns flowOf("paired")
        every { sessionStore.accentColor } returns flowOf("system")
        every { sessionStore.themeMode } returns flowOf("light")
        coEvery { sessionStore.activateSavedServer() } coAnswers {
            runtimeState.value = serverRuntimeState()
            true
        }
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
            todayRepository,
        )
        advanceUntilIdle()

        viewModel.activateSavedServer()
        advanceUntilIdle()

        assertEquals(WorkspaceMode.SERVER, viewModel.uiState.value.workspaceMode)
        assertEquals("1.0.0", viewModel.uiState.value.health?.version)
        coVerify(exactly = 1) { sessionStore.activateSavedServer() }
    }

    @Test
    fun `the calendar auto-add switch shows the server value and saves a change`() = runTest {
        stubServerLoad()
        coEvery { todayRepository.getSuggestions() } returns ApiResult.Success(TodaySuggestionList(autoAdd = true))
        coEvery { todayRepository.setSuggestionAutoAdd(false) } returns ApiResult.Success(false)
        val viewModel = newViewModel()
        advanceUntilIdle()
        assertEquals(true, viewModel.uiState.value.calendarAutoAdd)

        viewModel.setCalendarAutoAdd(false)
        advanceUntilIdle()

        coVerify(exactly = 1) { todayRepository.setSuggestionAutoAdd(false) }
        val state = viewModel.uiState.value
        assertEquals(false, state.calendarAutoAdd)
        assertFalse(state.isSavingCalendarAutoAdd)
        assertFalse(state.calendarAutoAddFailed)
    }

    @Test
    fun `a calendar auto-add change the server refuses is put back`() = runTest {
        stubServerLoad()
        coEvery { todayRepository.setSuggestionAutoAdd(false) } returns ApiResult.Error("Offline")
        val viewModel = newViewModel()
        advanceUntilIdle()

        viewModel.setCalendarAutoAdd(false)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(true, state.calendarAutoAdd)
        assertTrue(state.calendarAutoAddFailed)
        assertFalse(state.isSavingCalendarAutoAdd)
    }

    @Test
    fun `a device-only workspace has no calendar auto-add switch`() = runTest {
        runtimeState.value = AppRuntimeState(
            mode = WorkspaceMode.LOCAL,
            activeSession = null,
            hasSavedServerSession = false,
            workspaceKey = "local",
        )
        every { sessionStore.hostName } returns flowOf(null)
        every { sessionStore.accentColor } returns flowOf("system")
        every { sessionStore.themeMode } returns flowOf("light")
        val viewModel = newViewModel()
        advanceUntilIdle()

        assertNull(viewModel.uiState.value.calendarAutoAdd)
        viewModel.setCalendarAutoAdd(false)
        advanceUntilIdle()
        coVerify(exactly = 0) { todayRepository.getSuggestions() }
        coVerify(exactly = 0) { todayRepository.setSuggestionAutoAdd(any()) }
    }

    private fun stubServerLoad() {
        every { sessionStore.hostName } returns flowOf("demo.clawchat.app")
        every { sessionStore.accentColor } returns flowOf("system")
        every { sessionStore.themeMode } returns flowOf("light")
        coEvery { settingsRepository.health() } returns ApiResult.Success(
            HealthResponse(status = "ok", version = "1.0.0", aiProvider = "openai", aiModel = "gpt", aiConnected = true),
        )
        coEvery { deviceRepository.listDevices() } returns ApiResult.Success(DeviceListResponse(emptyList()))
    }

    private fun newViewModel() = SettingsViewModel(
        settingsRepository,
        deviceRepository,
        sessionStore,
        updateManager,
        syncManager,
        todayRepository,
    )

    private fun serverRuntimeState() = AppRuntimeState(
        mode = WorkspaceMode.SERVER,
        activeSession = ActiveSession(
            token = "device-token",
            apiBaseUrl = "https://demo.clawchat.app/api?token=hidden",
            hostId = "host-1",
            authMode = "paired",
        ),
        hasSavedServerSession = true,
        workspaceKey = "server:host:host-1",
    )
}
