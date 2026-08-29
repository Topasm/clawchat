package com.clawchat.android.feature.search

import com.clawchat.android.core.data.model.SearchHit
import com.clawchat.android.core.data.repository.SearchRepository
import com.clawchat.android.core.data.repository.SearchType
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
class SearchViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var repository: SearchRepository

    private fun hit(id: String, type: String, title: String = "Hit $id") =
        SearchHit(type = type, id = id, title = title, preview = "preview $id")

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repository = mockk()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel() = SearchViewModel(repository)

    @Test
    fun `typing searches once the pause is over`() = runTest {
        coEvery { repository.search("plan", any(), any()) } returns
            ApiResult.Success(listOf(hit("1", "todo")))

        val viewModel = viewModel()
        viewModel.onQueryChange("plan")

        dispatcher.scheduler.advanceTimeBy(200)
        assertFalse(viewModel.uiState.value.hasSearched)
        coVerify(exactly = 0) { repository.search(any(), any(), any()) }

        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(listOf("1"), viewModel.uiState.value.hits.map { it.id })
        assertTrue(viewModel.uiState.value.hasSearched)
    }

    @Test
    fun `only the last keystroke of a burst reaches the server`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns ApiResult.Success(emptyList())

        val viewModel = viewModel()
        viewModel.onQueryChange("p")
        dispatcher.scheduler.advanceTimeBy(100)
        viewModel.onQueryChange("pl")
        dispatcher.scheduler.advanceTimeBy(100)
        viewModel.onQueryChange("plan")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.search("plan", any(), any()) }
        coVerify(exactly = 0) { repository.search("p", any(), any()) }
        coVerify(exactly = 0) { repository.search("pl", any(), any()) }
    }

    @Test
    fun `an empty query never reaches the server and clears the results`() = runTest {
        coEvery { repository.search("plan", any(), any()) } returns
            ApiResult.Success(listOf(hit("1", "todo")))

        val viewModel = viewModel()
        viewModel.onQueryChange("plan")
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.onQueryChange("   ")
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.hits.isEmpty())
        assertFalse(state.hasSearched)
        coVerify(exactly = 0) { repository.search("   ", any(), any()) }
    }

    @Test
    fun `a type filter applies immediately and is passed through`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns ApiResult.Success(emptyList())

        val viewModel = viewModel()
        viewModel.onQueryChange("plan")
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.toggleType(SearchType.Events)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(setOf(SearchType.Events), viewModel.uiState.value.activeTypes)
        coVerify { repository.search("plan", setOf(SearchType.Events), any()) }
    }

    @Test
    fun `results are grouped under their type in server rank order`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns ApiResult.Success(
            listOf(
                hit("m1", "message"),
                hit("t1", "todo"),
                hit("t2", "todo"),
                hit("e1", "event"),
            ),
        )

        val viewModel = viewModel()
        viewModel.onQueryChange("plan")
        dispatcher.scheduler.advanceUntilIdle()

        val grouped = viewModel.uiState.value.grouped
        assertEquals(
            listOf(SearchType.Tasks, SearchType.Events, SearchType.Messages),
            grouped.map { it.first },
        )
        assertEquals(listOf("t1", "t2"), grouped.first().second.map { it.id })
    }

    @Test
    fun `a failure is reported and leaves no stale results`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns ApiResult.Error("offline")

        val viewModel = viewModel()
        viewModel.onQueryChange("plan")
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("offline", state.error)
        assertTrue(state.hits.isEmpty())
        assertFalse(state.isSearching)
    }

    @Test
    fun `clearing the query cancels the pending search`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns ApiResult.Success(emptyList())

        val viewModel = viewModel()
        viewModel.onQueryChange("plan")
        viewModel.clearQuery()
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 0) { repository.search(any(), any(), any()) }
        assertEquals("", viewModel.uiState.value.query)
        assertNull(viewModel.uiState.value.error)
    }
}
