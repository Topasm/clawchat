package com.clawchat.android.core.sync

import com.clawchat.android.core.network.SyncEvent
import com.clawchat.android.core.network.WebSocketClient
import io.mockk.Runs
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SyncManagerTest {

    private data class Fixture(
        val client: WebSocketClient,
        val events: MutableSharedFlow<SyncEvent>,
        val manager: SyncManager,
    )

    private fun TestScope.fixture(): Fixture {
        val events = MutableSharedFlow<SyncEvent>(extraBufferCapacity = 64)
        val client = mockk<WebSocketClient>()
        every { client.events } returns events
        every { client.connect() } just Runs
        every { client.disconnect() } just Runs
        val manager = SyncManager(
            webSocketClient = client,
            scope = CoroutineScope(StandardTestDispatcher(testScheduler)),
        )
        return Fixture(client, events, manager)
    }

    @Test
    fun `an initial stop does not disable a later session`() = runTest {
        val fixture = fixture()

        fixture.manager.stop()
        fixture.manager.start()
        assertTrue(fixture.events.tryEmit(SyncEvent.Connected))
        advanceUntilIdle()

        assertTrue(fixture.manager.isConnected.value)
        verify(exactly = 1) { fixture.client.connect() }
        verify(exactly = 1) { fixture.client.disconnect() }
        fixture.manager.stop()
    }

    @Test
    fun `repeated starts share one connection and one event collector`() = runTest {
        val fixture = fixture()
        var todoChanges = 0
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            fixture.manager.todoChanged.collect { todoChanges++ }
        }

        fixture.manager.start()
        fixture.manager.start()
        assertTrue(fixture.events.tryEmit(SyncEvent.ModuleChanged("todos")))
        advanceUntilIdle()

        assertEquals(1, todoChanges)
        verify(exactly = 1) { fixture.client.connect() }
        fixture.manager.stop()
    }

    @Test
    fun `review and run module changes invalidate their authoritative screens`() = runTest {
        val fixture = fixture()
        var reviewChanges = 0
        var runChanges = 0
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            fixture.manager.reviewChanged.collect { reviewChanges++ }
        }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            fixture.manager.runChanged.collect { runChanges++ }
        }

        fixture.manager.start()
        assertTrue(fixture.events.tryEmit(SyncEvent.ModuleChanged("reviews")))
        assertTrue(fixture.events.tryEmit(SyncEvent.ModuleChanged("runs")))
        advanceUntilIdle()

        assertEquals(1, reviewChanges)
        assertEquals(1, runChanges)
        fixture.manager.stop()
    }

    @Test
    fun `reconnect invalidates review and run state missed while offline`() = runTest {
        val fixture = fixture()
        var reviewChanges = 0
        var runChanges = 0
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            fixture.manager.reviewChanged.collect { reviewChanges++ }
        }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            fixture.manager.runChanged.collect { runChanges++ }
        }

        fixture.manager.start()
        assertTrue(fixture.events.tryEmit(SyncEvent.Connected))
        advanceUntilIdle()

        assertEquals(1, reviewChanges)
        assertEquals(1, runChanges)
        fixture.manager.stop()
    }

    @Test
    fun `session boundaries clear previous realtime diagnostics`() = runTest {
        val fixture = fixture()
        fixture.manager.start()
        assertTrue(fixture.events.tryEmit(SyncEvent.ModuleChanged("runs")))
        assertTrue(fixture.events.tryEmit(SyncEvent.Disconnected))
        advanceUntilIdle()

        assertTrue(fixture.manager.lastEventAtEpochMillis.value != null)
        assertEquals("Realtime connection closed", fixture.manager.lastConnectionError.value)

        fixture.manager.stop()
        assertEquals(null, fixture.manager.lastEventAtEpochMillis.value)
        assertEquals(null, fixture.manager.lastConnectionError.value)

        fixture.manager.start()
        assertEquals(null, fixture.manager.lastEventAtEpochMillis.value)
        assertEquals(null, fixture.manager.lastConnectionError.value)
        fixture.manager.stop()
    }

    @Test
    fun `stop resets state and restart installs a fresh collector`() = runTest {
        val fixture = fixture()

        fixture.manager.start()
        assertTrue(fixture.events.tryEmit(SyncEvent.Connected))
        fixture.manager.stop()
        advanceUntilIdle()

        assertFalse(fixture.manager.isConnected.value)

        fixture.manager.start()
        assertTrue(fixture.events.tryEmit(SyncEvent.Connected))
        advanceUntilIdle()

        assertTrue(fixture.manager.isConnected.value)
        verify(exactly = 2) { fixture.client.connect() }
        verify(exactly = 1) { fixture.client.disconnect() }
        fixture.manager.stop()
    }

    @Test
    fun `concurrent starts are idempotent`() = runTest {
        val fixture = fixture()

        coroutineScope {
            repeat(64) {
                launch(Dispatchers.Default) { fixture.manager.start() }
            }
        }

        verify(exactly = 1) { fixture.client.connect() }
        fixture.manager.stop()
    }
}
