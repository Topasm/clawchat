package com.clawchat.android.feature.devices

import com.clawchat.android.core.data.model.DataSource
import com.clawchat.android.core.data.model.DataSourceEntry
import com.clawchat.android.core.data.model.DataSourceQueryResult
import com.clawchat.android.core.data.repository.DataSourceRepository
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
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

@OptIn(ExperimentalCoroutinesApi::class)
class DevicesViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private lateinit var repository: DataSourceRepository

    private val vault = DataSource(
        id = "dsrc_1",
        hostLabel = "MacBook",
        name = "workspace",
        capabilities = listOf("list", "read", "search"),
        isOnline = true,
    )

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repository = mockk()
        coEvery { repository.listSources() } returns ApiResult.Success(listOf(vault))
        coEvery { repository.list("dsrc_1", any()) } answers {
            ApiResult.Success(
                DataSourceQueryResult(
                    op = "list",
                    path = secondArg(),
                    entries = listOf(DataSourceEntry(path = "00_Inbox", name = "00_Inbox", isDir = true)),
                ),
            )
        }
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel() = DevicesViewModel(repository)

    @Test
    fun `opens the first source at its top folder`() = runTest {
        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("dsrc_1", state.selectedSourceId)
        assertEquals(DevicesView.Folder(""), state.view)
        assertEquals("00_Inbox", state.result?.entries?.single()?.name)
        assertFalse(state.isLoading)
    }

    @Test
    fun `an offline machine's file explains why it cannot open`() = runTest {
        coEvery { repository.read("dsrc_1", "00_Inbox/TODO.md") } returns ApiResult.Error(
            message = "offline",
            code = 503,
            serverCode = "DATA_SOURCE_OFFLINE",
        )
        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.openFile("00_Inbox/TODO.md")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(DevicesError.Offline, viewModel.uiState.value.error)
        assertNull(viewModel.uiState.value.result)
    }

    @Test
    fun `a refused path is reported as not shared`() = runTest {
        coEvery { repository.read("dsrc_1", "02_Resources/bank.md") } returns ApiResult.Error(
            message = "not shared",
            code = 403,
            serverCode = "FORBIDDEN",
        )
        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.openFile("02_Resources/bank.md")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(DevicesError.NotShared, viewModel.uiState.value.error)
    }

    @Test
    fun `search runs in the folder being viewed and back returns to it`() = runTest {
        coEvery { repository.search("dsrc_1", "01_Projects", "E65") } returns ApiResult.Success(
            DataSourceQueryResult(op = "search", path = "01_Projects"),
        )
        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.openFolder("01_Projects")
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.onSearchTextChange("  E65 ")
        viewModel.submitSearch()
        dispatcher.scheduler.advanceUntilIdle()

        coVerify { repository.search("dsrc_1", "01_Projects", "E65") }
        assertEquals(DevicesView.Search("01_Projects", "E65"), viewModel.uiState.value.view)
        assertTrue(viewModel.goUp())
        assertEquals(DevicesView.Folder("01_Projects"), viewModel.uiState.value.view)
    }

    @Test
    fun `back at the top leaves the screen`() = runTest {
        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        assertFalse(viewModel.goUp())
    }

    @Test
    fun `parent of a nested path`() {
        assertEquals("01_Projects", parentOf("01_Projects/E65"))
        assertEquals("", parentOf("README.md"))
    }
}
