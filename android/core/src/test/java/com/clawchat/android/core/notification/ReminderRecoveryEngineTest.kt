package com.clawchat.android.core.notification

import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.ZoneId

class ReminderRecoveryEngineTest {
    private val now = Instant.parse("2026-08-31T01:00:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)
    private val sessionA = ReminderSession("token-a", "url:https://a.example")

    @Test
    fun `manual token rotation keeps normalized server scope`() {
        val before = ActiveSession(
            token = "old",
            apiBaseUrl = "HTTPS://A.Example:443/",
            hostId = null,
            authMode = "manual",
        ).toReminderSession()
        val after = ActiveSession(
            token = "new",
            apiBaseUrl = "https://a.example",
            hostId = null,
            authMode = "manual",
        ).toReminderSession()

        assertEquals(before?.scope, after?.scope)
        assertEquals("url:https://a.example", after?.scope)
    }

    @Test
    fun `paired host identity survives a direct URL change`() {
        val before = ActiveSession("old", "http://192.0.2.1:8000", "host-1", "paired")
        val after = ActiveSession("new", "https://relay.example", "host-1", "paired")

        assertEquals(before.toReminderSession()?.scope, after.toReminderSession()?.scope)
        assertEquals("host:host-1", after.toReminderSession()?.scope)
    }

    @Test
    fun `no session exits without touching network or cache`() = runTest {
        val source = FakeSource()
        val harness = harness(source = source, session = { null })

        assertEquals(ReminderRecoveryResult.NoSession, harness.engine.recover())
        assertEquals(0, source.todoFetches)
        assertEquals(0, source.eventFetches)
        assertTrue(harness.delivered.isEmpty())
    }

    @Test
    fun `server data recovers due event todo and overdue todo only once`() = runTest {
        val source = FakeSource(
            remoteTodos = ApiResult.Success(
                listOf(
                    todo("due", now.plusSeconds(30 * 60)),
                    todo("late", now.minusSeconds(5 * 60)),
                    todo("later", now.plusSeconds(90 * 60)),
                    todo("done", now.plusSeconds(10 * 60), TaskStatus.COMPLETED),
                ),
            ),
            remoteEvents = ApiResult.Success(
                listOf(
                    event("standup", "2026-08-31T01:15:00", 30),
                    event("too-early", "2026-08-31T01:50:00Z", 5),
                ),
            ),
        )
        val harness = harness(source)

        assertEquals(ReminderRecoveryResult.Success, harness.engine.recover())
        assertEquals(
            listOf("event:standup", "todo:due", "todo_overdue:late"),
            harness.delivered.map { "${it.reminderType}:${it.itemId}" },
        )

        harness.engine.recover()
        assertEquals(3, harness.delivered.size)
        assertEquals(0, source.todoCacheReads)
        assertEquals(0, source.eventCacheReads)
    }

    @Test
    fun `date-only deadline alerts on the device local due day`() = runTest {
        val seoulNow = Instant.parse("2026-08-31T15:10:00Z") // 2026-09-01 00:10 KST
        val source = FakeSource(
            remoteTodos = ApiResult.Success(
                listOf(
                    todoWithDueText("today", "2026-09-01"),
                    todoWithDueText("server-midnight", "2026-09-01T00:00:00"),
                    todoWithDueText("tomorrow", "2026-09-02"),
                ),
            ),
        )
        val harness = harness(
            source = source,
            clock = Clock.fixed(seoulNow, ZoneOffset.UTC),
            zoneId = ZoneId.of("Asia/Seoul"),
        )

        harness.engine.recover()

        assertEquals(
            setOf("today", "server-midnight"),
            harness.delivered.map { it.itemId }.toSet(),
        )
        assertTrue(harness.delivered.all { it.reminderType == "todo_due_today" })
        assertEquals(Instant.parse("2026-09-01T15:00:00Z"), source.lastTodoDueBefore)
    }

    @Test
    fun `event horizon supports two-hour and one-day leads but waits for remindAt`() = runTest {
        val source = FakeSource(
            remoteEvents = ApiResult.Success(
                listOf(
                    event("two-hour", now.plusSeconds(120 * 60).toString(), 120),
                    event("one-day", now.plusSeconds(1_440 * 60).toString(), 1_440),
                    event("not-yet", now.plusSeconds(121 * 60).toString(), 120),
                ),
            ),
        )
        val harness = harness(source)

        harness.engine.recover()

        assertEquals(setOf("two-hour", "one-day"), harness.delivered.map { it.itemId }.toSet())
        assertEquals(Instant.parse("2026-09-01T00:00:00Z"), source.lastTodoDueBefore)
        assertEquals(LocalDate.parse("2026-09-01"), source.lastEventTo)
    }

    @Test
    fun `worker catches a short-lead event just after start within bounded grace`() = runTest {
        val source = FakeSource(
            remoteEvents = ApiResult.Success(
                listOf(
                    event("started-ten-ago", now.minusSeconds(10 * 60).toString(), 5),
                    event("started-twenty-one-ago", now.minusSeconds(21 * 60).toString(), 10),
                    event("reminder-not-due", now.plusSeconds(10 * 60).toString(), 5),
                ),
            ),
        )
        val harness = harness(source)

        harness.engine.recover()

        assertEquals(listOf("started-ten-ago"), harness.delivered.map { it.itemId })
        assertTrue(harness.delivered.single().message.contains("started 10 minute"))
        assertEquals(LocalDate.parse("2026-08-31"), source.lastEventFrom)
    }

    @Test
    fun `network failures use only ids trusted by a remote success for this scope`() = runTest {
        val source = FakeSource(
            remoteTodos = ApiResult.Error("offline"),
            remoteEvents = ApiResult.Error("unavailable", 503),
            cachedTodos = listOf(
                todo("trusted-todo", now.plusSeconds(20 * 60)),
                todo("other-server-todo", now.plusSeconds(20 * 60)),
            ),
            cachedEvents = listOf(
                event("trusted-event", "2026-08-31T01:10:00Z", 15),
                event("other-server-event", "2026-08-31T01:10:00Z", 15),
            ),
        )
        val trust = FakeCacheTrust().apply {
            recordTrustedIds(sessionA.scope, ReminderCacheBucket.TODOS, setOf("trusted-todo"))
            recordTrustedIds(sessionA.scope, ReminderCacheBucket.EVENTS, setOf("trusted-event"))
        }
        val harness = harness(source, cacheTrust = trust)

        assertEquals(ReminderRecoveryResult.Retry, harness.engine.recover())
        assertEquals(
            setOf("trusted-todo", "trusted-event"),
            harness.delivered.map { it.itemId }.toSet(),
        )
        assertEquals(1, source.todoCacheReads)
        assertEquals(1, source.eventCacheReads)
    }

    @Test
    fun `switching server A to B cannot expose A Room titles`() = runTest {
        val sessionB = ReminderSession("token-b", "url:https://b.example")
        val source = FakeSource(
            remoteTodos = ApiResult.Error("offline"),
            remoteEvents = ApiResult.Error("offline"),
            cachedTodos = listOf(todo("server-a", now.plusSeconds(10 * 60))),
            cachedEvents = listOf(event("server-a-event", "2026-08-31T01:10:00Z", 15)),
        )
        val trust = FakeCacheTrust().apply {
            recordTrustedIds(sessionA.scope, ReminderCacheBucket.TODOS, setOf("server-a"))
            recordTrustedIds(sessionA.scope, ReminderCacheBucket.EVENTS, setOf("server-a-event"))
        }
        val harness = harness(source, session = { sessionB }, cacheTrust = trust)

        assertEquals(ReminderRecoveryResult.Retry, harness.engine.recover())
        assertTrue(harness.delivered.isEmpty())
        assertEquals(0, source.todoCacheReads)
        assertEquals(0, source.eventCacheReads)
    }

    @Test
    fun `token rotation on the same server preserves trusted cache`() = runTest {
        val rotated = ReminderSession("rotated-token", sessionA.scope)
        val source = FakeSource(
            remoteTodos = ApiResult.Error("offline"),
            cachedTodos = listOf(todo("same-server", now.plusSeconds(10 * 60))),
        )
        val trust = FakeCacheTrust().apply {
            recordTrustedIds(sessionA.scope, ReminderCacheBucket.TODOS, setOf("same-server"))
        }
        val harness = harness(source, session = { rotated }, cacheTrust = trust)

        assertEquals(ReminderRecoveryResult.Retry, harness.engine.recover())
        assertEquals(listOf("same-server"), harness.delivered.map { it.itemId })
    }

    @Test
    fun `remote success replaces trusted ids before a later fallback`() = runTest {
        val source = FakeSource(
            remoteTodos = ApiResult.Success(listOf(todo("server-b", now.plusSeconds(2 * 60 * 60)))),
        )
        val trust = FakeCacheTrust().apply {
            recordTrustedIds(sessionA.scope, ReminderCacheBucket.TODOS, setOf("server-a"))
        }
        val harness = harness(source, cacheTrust = trust)
        harness.engine.recover()

        source.remoteTodos = ApiResult.Error("offline")
        source.cachedTodos = listOf(
            todo("server-a", now.plusSeconds(10 * 60)),
            todo("server-b", now.plusSeconds(10 * 60)),
        )
        harness.engine.recover()

        assertEquals(listOf("server-b"), harness.delivered.map { it.itemId })
    }

    @Test
    fun `unauthorized response clears session without exposing cached reminders`() = runTest {
        val source = FakeSource(
            remoteTodos = ApiResult.Error("unauthorized", 401),
            cachedTodos = listOf(todo("old-account", now.plusSeconds(10 * 60))),
        )
        val harness = harness(source)

        assertEquals(ReminderRecoveryResult.AuthenticationEnded, harness.engine.recover())
        assertEquals(1, harness.sessionClears())
        assertEquals(0, source.eventFetches)
        assertEquals(0, source.todoCacheReads)
        assertTrue(harness.delivered.isEmpty())
    }

    @Test
    fun `permanent failure does not trust an unscoped legacy cache`() = runTest {
        val source = FakeSource(
            remoteTodos = ApiResult.Error("bad request", 422),
            cachedTodos = listOf(todo("legacy", now.plusSeconds(10 * 60))),
        )
        val harness = harness(source)

        assertEquals(ReminderRecoveryResult.PermanentFailure, harness.engine.recover())
        assertTrue(harness.delivered.isEmpty())
        assertEquals(0, source.todoCacheReads)
    }

    @Test
    fun `notification rejection releases claims for a later permission grant`() = runTest {
        var notificationAllowed = false
        var attempts = 0
        val source = FakeSource(
            remoteTodos = ApiResult.Success(listOf(todo("due", now.plusSeconds(10 * 60)))),
        )
        val engine = ReminderRecoveryEngine(
            session = { sessionA },
            clearSession = {},
            source = source,
            notifier = {
                attempts++
                notificationAllowed
            },
            claims = FakeClaims(),
            cacheTrust = FakeCacheTrust(),
            clock = clock,
        )

        engine.recover()
        engine.recover()
        assertEquals(2, attempts)

        notificationAllowed = true
        engine.recover()
        engine.recover()
        assertEquals(3, attempts)
    }

    @Test
    fun `exact WebSocket occurrence suppresses worker after todo becomes overdue`() = runTest {
        val due = now.plusSeconds(10 * 60)
        val exactKey = workspaceReminderClaimKey(
            sessionA.workspaceKey,
            reminderDeliveryKey("todo", "due", due.epochSecond),
        )
        val claims = FakeClaims().apply {
            claim(exactKey, now.toEpochMilli(), EXACT_REMINDER_WINDOW_MILLIS)
        }
        val source = FakeSource(remoteTodos = ApiResult.Success(listOf(todo("due", due))))
        val delayedClock = Clock.fixed(now.plusSeconds(20 * 60), ZoneOffset.UTC)
        val harness = harness(source, claims = claims, clock = delayedClock)

        harness.engine.recover()

        assertTrue(harness.delivered.isEmpty())
        assertEquals(setOf(exactKey), claims.keys)
    }

    @Test
    fun `same reminder identity can be delivered in two workspaces`() = runTest {
        val due = now.plusSeconds(10 * 60)
        val source = FakeSource(remoteTodos = ApiResult.Success(listOf(todo("shared-id", due))))
        val claims = FakeClaims()
        val first = harness(
            source = source,
            session = { ReminderSession("token-a", "host:a", "server:a") },
            claims = claims,
        )
        val second = harness(
            source = source,
            session = { ReminderSession("token-b", "host:b", "server:b") },
            claims = claims,
        )

        first.engine.recover()
        second.engine.recover()

        assertEquals(listOf("shared-id"), first.delivered.map { it.itemId })
        assertEquals(listOf("shared-id"), second.delivered.map { it.itemId })
    }

    @Test
    fun `delivery cap advances past existing claims on the next recovery`() = runTest {
        val source = FakeSource(
            remoteTodos = ApiResult.Success(
                (1..25).map { index -> todo("due-$index", now.plusSeconds(index * 60L)) },
            ),
        )
        val harness = harness(source)

        harness.engine.recover()
        assertEquals(20, harness.delivered.size)
        harness.engine.recover()
        assertEquals(25, harness.delivered.size)
    }

    private fun harness(
        source: FakeSource,
        session: suspend () -> ReminderSession? = { sessionA },
        claims: FakeClaims = FakeClaims(),
        cacheTrust: FakeCacheTrust = FakeCacheTrust(),
        clock: Clock = this.clock,
        zoneId: ZoneId = ZoneOffset.UTC,
    ): Harness {
        val delivered = mutableListOf<RecoveredReminder>()
        var sessionClears = 0
        val engine = ReminderRecoveryEngine(
            session = session,
            clearSession = { sessionClears++ },
            source = source,
            notifier = {
                delivered += it
                true
            },
            claims = claims,
            cacheTrust = cacheTrust,
            clock = clock,
            zoneId = zoneId,
        )
        return Harness(engine, delivered) { sessionClears }
    }

    private fun todo(
        id: String,
        due: Instant,
        status: TaskStatus = TaskStatus.PENDING,
    ) = Todo(id = id, title = id, dueDate = due.toString(), status = status)

    private fun todoWithDueText(id: String, due: String) =
        Todo(id = id, title = id, dueDate = due, status = TaskStatus.PENDING)

    private fun event(id: String, start: String, reminderMinutes: Int) = Event(
        id = id,
        title = id,
        startTime = start,
        reminderMinutes = reminderMinutes,
    )

    private data class Harness(
        val engine: ReminderRecoveryEngine,
        val delivered: List<RecoveredReminder>,
        val sessionClears: () -> Int,
    )

    private class FakeSource(
        var remoteTodos: ApiResult<List<Todo>> = ApiResult.Success(emptyList()),
        var remoteEvents: ApiResult<List<Event>> = ApiResult.Success(emptyList()),
        var cachedTodos: List<Todo> = emptyList(),
        var cachedEvents: List<Event> = emptyList(),
    ) : ReminderRecoverySource {
        var todoFetches = 0
        var eventFetches = 0
        var todoCacheReads = 0
        var eventCacheReads = 0
        var lastTodoDueBefore: Instant? = null
        var lastEventFrom: LocalDate? = null
        var lastEventTo: LocalDate? = null

        override suspend fun fetchTodos(dueBefore: Instant): ApiResult<List<Todo>> {
            todoFetches++
            lastTodoDueBefore = dueBefore
            return remoteTodos
        }

        override suspend fun cachedTodos(): List<Todo> {
            todoCacheReads++
            return cachedTodos
        }

        override suspend fun fetchEvents(from: LocalDate, to: LocalDate): ApiResult<List<Event>> {
            eventFetches++
            lastEventFrom = from
            lastEventTo = to
            return remoteEvents
        }

        override suspend fun cachedEvents(from: LocalDate, to: LocalDate): List<Event> {
            eventCacheReads++
            return cachedEvents
        }
    }

    private class FakeClaims : ReminderClaimStore {
        private val claims = mutableMapOf<String, Long>()
        val keys: Set<String> get() = claims.keys

        override fun claim(key: String, claimedAtMillis: Long, suppressForMillis: Long): Boolean {
            val previous = claims[key]
            if (previous != null && claimedAtMillis - previous in 0 until suppressForMillis) {
                return false
            }
            claims[key] = claimedAtMillis
            return true
        }

        override fun release(key: String, claimedAtMillis: Long) {
            if (claims[key] == claimedAtMillis) claims.remove(key)
        }
    }

    private class FakeCacheTrust : ReminderCacheTrustStore {
        private val snapshots = mutableMapOf<Pair<String, ReminderCacheBucket>, Set<String>>()

        override fun recordTrustedIds(
            scope: String,
            bucket: ReminderCacheBucket,
            itemIds: Set<String>,
        ) {
            snapshots[scope to bucket] = itemIds.toSet()
        }

        override fun trustedIds(scope: String, bucket: ReminderCacheBucket): Set<String>? =
            snapshots[scope to bucket]
    }
}
