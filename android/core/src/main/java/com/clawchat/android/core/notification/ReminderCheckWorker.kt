package com.clawchat.android.core.notification

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.clawchat.android.core.R
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.EventRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import java.net.URI
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

private const val MAX_SUPPORTED_EVENT_REMINDER_MINUTES = 1_440
private val EVENT_START_GRACE: Duration = Duration.ofMinutes(20)

/**
 * Periodic fallback for reminders missed while the app process or WebSocket is
 * unavailable. The server remains authoritative; Room is used when the server
 * is temporarily unreachable.
 */
class ReminderCheckWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            val dependencies = EntryPointAccessors.fromApplication(
                applicationContext,
                ReminderWorkerEntryPoint::class.java,
            )
            val sessionStore = dependencies.sessionStore()
            val ledger = ReminderDeliveryLedger(applicationContext)
            val engine = ReminderRecoveryEngine(
                session = {
                    val runtimeState = sessionStore.runtimeState.first()
                    when (runtimeState.mode) {
                        WorkspaceMode.LOCAL -> LOCAL_REMINDER_SESSION
                        WorkspaceMode.SERVER -> runtimeState.activeSession?.toReminderSession(
                            runtimeState.workspaceKey,
                        )
                        WorkspaceMode.UNCONFIGURED -> null
                    }
                },
                clearSession = sessionStore::clearSession,
                source = RepositoryReminderRecoverySource(
                    dependencies.todoRepository(),
                    dependencies.eventRepository(),
                ),
                notifier = { reminder ->
                    ReminderNotificationHelper.showReminderNotification(
                        context = applicationContext,
                        reminderType = reminder.reminderType,
                        itemId = reminder.itemId,
                        title = reminder.title,
                        message = reminder.localizedMessage(applicationContext),
                        workspaceKey = reminder.workspaceKey,
                        // The recovery engine has already atomically claimed
                        // both the exact reminder and the cross-channel key.
                        deduplicate = false,
                    )
                },
                claims = ledger,
                cacheTrust = ledger,
            )

            val recoveryResult = engine.recover()
            Log.d(TAG, "Reminder recovery finished: $recoveryResult")
            when (recoveryResult) {
                ReminderRecoveryResult.Success,
                ReminderRecoveryResult.NoSession,
                ReminderRecoveryResult.AuthenticationEnded,
                -> Result.success()

                ReminderRecoveryResult.Retry -> Result.retry()
                ReminderRecoveryResult.PermanentFailure -> Result.failure()
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Log.e(TAG, "Reminder recovery failed unexpectedly", error)
            Result.retry()
        }
    }

    private companion object {
        const val TAG = "ReminderCheckWorker"
        val LOCAL_REMINDER_SESSION = ReminderSession(token = "", scope = "local")
    }
}

/** Hilt bridge used because this library does not own the Application class. */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface ReminderWorkerEntryPoint {
    fun sessionStore(): SessionStore
    fun todoRepository(): TodoRepository
    fun eventRepository(): EventRepository
}

internal enum class ReminderRecoveryResult {
    Success,
    NoSession,
    AuthenticationEnded,
    Retry,
    PermanentFailure,
}

internal data class ReminderSession(
    val token: String,
    val scope: String,
    val workspaceKey: String = scope,
)

internal data class RecoveredReminder(
    val reminderType: String,
    val itemId: String,
    val title: String,
    val message: String,
    val distanceMinutes: Long = 0,
    val scheduledAt: Instant,
    val exactClaimKey: String,
    val isOverdue: Boolean,
    val workspaceKey: String,
)

internal interface ReminderRecoverySource {
    suspend fun fetchTodos(dueBefore: Instant): ApiResult<List<Todo>>
    suspend fun cachedTodos(): List<Todo>
    suspend fun fetchEvents(from: LocalDate, to: LocalDate): ApiResult<List<Event>>
    suspend fun cachedEvents(from: LocalDate, to: LocalDate): List<Event>
}

internal class RepositoryReminderRecoverySource(
    private val todoRepository: TodoRepository,
    private val eventRepository: EventRepository,
) : ReminderRecoverySource {
    override suspend fun fetchTodos(dueBefore: Instant): ApiResult<List<Todo>> {
        val common = mapOf(
            "due_before" to dueBefore.toString(),
            "limit" to PAGE_LIMIT.toString(),
            // Descending keeps due-soon and recently overdue tasks if an
            // unusually large workspace exceeds the server page limit.
            "order_by" to "due_date",
            "order_dir" to "desc",
        )
        val pending = todoRepository.listTodos(
            common + ("status" to TaskStatus.PENDING.wireValue),
        )
        when (pending) {
            is ApiResult.Error -> return pending
            ApiResult.Loading -> return ApiResult.Loading
            is ApiResult.Success -> Unit
        }

        val inProgress = todoRepository.listTodos(
            common + ("status" to TaskStatus.IN_PROGRESS.wireValue),
        )
        when (inProgress) {
            is ApiResult.Error -> return inProgress
            ApiResult.Loading -> return ApiResult.Loading
            is ApiResult.Success -> Unit
        }

        return ApiResult.Success(
            (pending.data.items + inProgress.data.items).distinctBy(Todo::id),
        )
    }

    override suspend fun cachedTodos(): List<Todo> =
        todoRepository.getCachedTodosFlow().first()

    override suspend fun fetchEvents(from: LocalDate, to: LocalDate): ApiResult<List<Event>> =
        eventRepository.listEvents(from, to)

    override suspend fun cachedEvents(from: LocalDate, to: LocalDate): List<Event> =
        eventRepository.cachedEvents(from, to)

    private companion object {
        const val PAGE_LIMIT = 1_000
    }
}

/** Pure orchestration logic; Android/WorkManager is only an adapter around it. */
internal class ReminderRecoveryEngine(
    private val session: suspend () -> ReminderSession?,
    private val clearSession: suspend () -> Unit,
    private val source: ReminderRecoverySource,
    private val notifier: suspend (RecoveredReminder) -> Boolean,
    private val claims: ReminderClaimStore,
    private val cacheTrust: ReminderCacheTrustStore,
    private val clock: Clock = Clock.systemUTC(),
    private val zoneId: ZoneId = ZoneId.systemDefault(),
) {
    suspend fun recover(): ReminderRecoveryResult {
        val initialSession = session() ?: return ReminderRecoveryResult.NoSession

        val now = clock.instant()
        // Date-only task deadlines mean the user's local calendar day, not UTC
        // midnight. Fetch through the end of today so those tasks can alert on
        // the due date even when their stored timestamp is more than an hour away.
        val endOfLocalToday = now.atZone(zoneId).toLocalDate().plusDays(1)
            .atStartOfDay(zoneId).toInstant()
        val todoReminderHorizon = now.plus(TODO_REMINDER_HORIZON)
        val todoFetchHorizon = maxOf(todoReminderHorizon, endOfLocalToday)
        val eventHorizon = now.plus(EVENT_REMINDER_HORIZON)
        // LocalDate.ofInstant was only added to Android at API 34. The
        // equivalent Java 8 path keeps the WorkManager fallback valid on our
        // API 26 minimum.
        val fromDate = now.minus(EVENT_START_GRACE).atZone(ZoneOffset.UTC).toLocalDate()
        val toDate = eventHorizon.atZone(ZoneOffset.UTC).toLocalDate()

        val remoteTodos = source.fetchTodos(todoFetchHorizon)
        if (remoteTodos.isAuthenticationFailure()) {
            return endAuthenticatedSession(initialSession)
        }

        val remoteEvents = source.fetchEvents(fromDate, toDate)
        if (remoteEvents.isAuthenticationFailure()) {
            return endAuthenticatedSession(initialSession)
        }

        // A request can finish after the user switches servers. Never attach
        // its response (or the old Room rows) to the new session.
        val currentSession = session() ?: return ReminderRecoveryResult.NoSession
        if (currentSession.scope != initialSession.scope) {
            return ReminderRecoveryResult.Retry
        }

        val todos = when (remoteTodos) {
            is ApiResult.Success -> remoteTodos.data.also { items ->
                cacheTrust.recordTrustedIds(
                    initialSession.scope,
                    ReminderCacheBucket.TODOS,
                    items.mapTo(mutableSetOf(), Todo::id),
                )
            }
            else -> trustedCachedTodos(initialSession.scope)
        }
        val events = when (remoteEvents) {
            is ApiResult.Success -> remoteEvents.data.also { items ->
                cacheTrust.recordTrustedIds(
                    initialSession.scope,
                    ReminderCacheBucket.EVENTS,
                    items.mapTo(mutableSetOf(), Event::id),
                )
            }
            else -> trustedCachedEvents(initialSession.scope, fromDate, toDate)
        }

        val candidates = (
            todos.mapNotNull {
                it.toRecoveredReminder(now, todoReminderHorizon, initialSession.workspaceKey, zoneId)
            } + events.mapNotNull {
                it.toRecoveredReminder(now, eventHorizon, initialSession.workspaceKey)
            }
            )
            .distinctBy(RecoveredReminder::exactClaimKey)
            .sortedWith(
                compareBy<RecoveredReminder> { it.isOverdue }
                    .thenBy { Duration.between(now, it.scheduledAt).abs() },
            )

        var delivered = 0
        for (candidate in candidates) {
            if (delivered >= MAX_DELIVERIES_PER_RUN) break
            if (deliver(candidate, now.toEpochMilli())) delivered++
        }

        return listOf(remoteTodos, remoteEvents).toRecoveryResult()
    }

    private suspend fun endAuthenticatedSession(
        initialSession: ReminderSession,
    ): ReminderRecoveryResult {
        // Do not let a late 401 from server A clear a newly-created session B,
        // or a token that was rotated while this worker was in flight.
        if (session() != initialSession) return ReminderRecoveryResult.Retry
        clearSession()
        return ReminderRecoveryResult.AuthenticationEnded
    }

    private suspend fun trustedCachedTodos(scope: String): List<Todo> {
        val trustedIds = cacheTrust.trustedIds(scope, ReminderCacheBucket.TODOS)
            ?: return emptyList()
        return source.cachedTodos().filter { it.id in trustedIds }
    }

    private suspend fun trustedCachedEvents(
        scope: String,
        from: LocalDate,
        to: LocalDate,
    ): List<Event> {
        val trustedIds = cacheTrust.trustedIds(scope, ReminderCacheBucket.EVENTS)
            ?: return emptyList()
        return source.cachedEvents(from, to).filter { it.id in trustedIds }
    }

    private suspend fun deliver(candidate: RecoveredReminder, claimedAt: Long): Boolean {
        val exactClaimKey = workspaceReminderClaimKey(
            candidate.workspaceKey,
            candidate.exactClaimKey,
        )
        if (!claims.claim(exactClaimKey, claimedAt, EXACT_REMINDER_WINDOW_MILLIS)) {
            return false
        }

        val recentKey = workspaceReminderClaimKey(
            candidate.workspaceKey,
            recentReminderKey(candidate.reminderType, candidate.itemId),
        )
        if (!claims.claim(recentKey, claimedAt, RECENT_REMINDER_WINDOW_MILLIS)) {
            // A recent WebSocket delivery owns the coarse claim. Retaining the
            // exact claim records that this scheduled occurrence was covered.
            return false
        }

        return try {
            if (!notifier(candidate)) {
                // Permission/channel failures must not consume the reminder;
                // it can be recovered after the user enables notifications.
                claims.release(exactClaimKey, claimedAt)
                claims.release(recentKey, claimedAt)
                false
            } else {
                true
            }
        } catch (error: Exception) {
            claims.release(exactClaimKey, claimedAt)
            claims.release(recentKey, claimedAt)
            throw error
        }
    }

    private companion object {
        val TODO_REMINDER_HORIZON: Duration = Duration.ofMinutes(60)
        // The picker supports reminders up to one day before an event.
        val EVENT_REMINDER_HORIZON: Duration =
            Duration.ofMinutes(MAX_SUPPORTED_EVENT_REMINDER_MINUTES.toLong())
        const val MAX_DELIVERIES_PER_RUN = 20
    }
}

private fun Todo.toRecoveredReminder(
    now: Instant,
    horizon: Instant,
    workspaceKey: String,
    zoneId: ZoneId,
): RecoveredReminder? {
    if (status != TaskStatus.PENDING && status != TaskStatus.IN_PROGRESS) return null
    val rawDue = dueDate ?: return null
    val dueDateOnly = rawDue.toReminderDateOnly()
    if (dueDateOnly != null) {
        val today = now.atZone(zoneId).toLocalDate()
        if (dueDateOnly > today) return null
        val overdue = dueDateOnly < today
        val due = dueDateOnly.atStartOfDay(zoneId).toInstant()
        val type = if (overdue) "todo_overdue" else "todo_due_today"
        return RecoveredReminder(
            reminderType = type,
            itemId = id,
            title = title,
            message = if (overdue) "'$title' is overdue." else "'$title' is due today.",
            scheduledAt = due,
            exactClaimKey = reminderDeliveryKey(type, id, due.epochSecond),
            isOverdue = overdue,
            workspaceKey = workspaceKey,
        )
    }

    val due = rawDue.toReminderInstant() ?: return null
    if (due > horizon) return null

    val overdue = due < now
    val type = if (overdue) "todo_overdue" else "todo"
    val minutesUntil = Duration.between(now, due).toMinutes().coerceAtLeast(0)
    return RecoveredReminder(
        reminderType = type,
        itemId = id,
        title = title,
        message = if (overdue) {
            "'$title' is overdue."
        } else {
            "'$title' is due in $minutesUntil minute(s)."
        },
        distanceMinutes = minutesUntil,
        scheduledAt = due,
        exactClaimKey = reminderDeliveryKey(type, id, due.epochSecond),
        isOverdue = overdue,
        workspaceKey = workspaceKey,
    )
}

private fun Event.toRecoveredReminder(
    now: Instant,
    horizon: Instant,
    workspaceKey: String,
): RecoveredReminder? {
    val leadMinutes = reminderMinutes ?: return null
    if (leadMinutes !in 0..MAX_SUPPORTED_EVENT_REMINDER_MINUTES) return null
    val start = startTime.toReminderInstant() ?: return null
    // A 15-minute periodic worker can first run shortly after a 5/10-minute
    // reminder's event has started. Keep a small, bounded recovery window.
    if (start < now.minus(EVENT_START_GRACE) || start > horizon) return null
    val remindAt = start.minusSeconds(leadMinutes * 60L)
    if (remindAt > now) return null

    val started = start < now
    val distanceMinutes = Duration.between(now, start).abs().toMinutes()
    return RecoveredReminder(
        reminderType = "event",
        itemId = id,
        title = title,
        message = if (started) {
            "'$title' started $distanceMinutes minute(s) ago."
        } else {
            "'$title' starts in $distanceMinutes minute(s)."
        },
        distanceMinutes = distanceMinutes,
        scheduledAt = start,
        exactClaimKey = reminderDeliveryKey("event", occurrenceKey, start.epochSecond),
        isOverdue = started,
        workspaceKey = workspaceKey,
    )
}

private fun RecoveredReminder.localizedMessage(context: Context): String {
    val quantity = distanceMinutes.coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
    return when (reminderType) {
        "todo_overdue" -> context.getString(R.string.notification_todo_overdue, title)
        "todo_due_today" -> context.getString(R.string.notification_todo_due_today, title)
        "todo" -> context.resources.getQuantityString(
            R.plurals.notification_todo_due_in_minutes,
            quantity,
            title,
            distanceMinutes,
        )
        "event" -> context.resources.getQuantityString(
            if (isOverdue) {
                R.plurals.notification_event_started_minutes_ago
            } else {
                R.plurals.notification_event_starts_in_minutes
            },
            quantity,
            title,
            distanceMinutes,
        )
        else -> message
    }
}

internal fun ActiveSession.toReminderSession(workspaceKey: String? = null): ReminderSession? {
    val stableScope = if (authMode == "paired" && !hostId.isNullOrBlank()) {
        "host:${hostId.trim()}"
    } else {
        apiBaseUrl.toNormalizedReminderBaseUrl()?.let { "url:$it" }
    } ?: return null
    return ReminderSession(
        token = token,
        scope = stableScope,
        workspaceKey = workspaceKey ?: stableScope,
    )
}

internal fun String?.toNormalizedReminderBaseUrl(): String? {
    val raw = this?.trim()?.trimEnd('/')?.takeIf(String::isNotEmpty) ?: return null
    return runCatching {
        val uri = URI(raw).normalize()
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return@runCatching raw
        val host = uri.host?.lowercase(Locale.ROOT) ?: return@runCatching raw
        val port = when {
            uri.port < 0 -> ""
            scheme == "http" && uri.port == 80 -> ""
            scheme == "https" && uri.port == 443 -> ""
            else -> ":${uri.port}"
        }
        val path = uri.rawPath.orEmpty().trimEnd('/')
        "$scheme://$host$port$path"
    }.getOrDefault(raw)
}

private fun String.toReminderInstant(): Instant? =
    runCatching { Instant.parse(this) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(this).toInstant() }.getOrNull()
        // SQLite-backed self-hosted servers can serialize a UTC value without
        // an offset. Server reminder checks interpret those values as UTC too.
        ?: runCatching { LocalDateTime.parse(this).toInstant(ZoneOffset.UTC) }.getOrNull()
        ?: runCatching { LocalDate.parse(this).atStartOfDay().toInstant(ZoneOffset.UTC) }.getOrNull()

/** Server datetime serialization preserves a date-picker deadline as midnight. */
private fun String.toReminderDateOnly(): LocalDate? {
    runCatching { LocalDate.parse(this) }.getOrNull()?.let { return it }
    runCatching { LocalDateTime.parse(this) }.getOrNull()?.let { value ->
        if (value.toLocalTime() == java.time.LocalTime.MIDNIGHT) return value.toLocalDate()
    }
    runCatching { OffsetDateTime.parse(this) }.getOrNull()?.let { value ->
        if (value.toLocalTime() == java.time.LocalTime.MIDNIGHT) return value.toLocalDate()
    }
    return null
}

private fun ApiResult<*>.isAuthenticationFailure(): Boolean =
    this is ApiResult.Error && (code == 401 || code == 403)

private fun List<ApiResult<*>>.toRecoveryResult(): ReminderRecoveryResult {
    val failures = filterNot { it is ApiResult.Success }
    if (failures.isEmpty()) return ReminderRecoveryResult.Success

    val hasRetryable = failures.any { result ->
        when (result) {
            ApiResult.Loading -> true
            is ApiResult.Error ->
                result.code == null ||
                    result.code in setOf(408, 425, 429) ||
                    result.code >= 500
            is ApiResult.Success -> false
        }
    }
    return if (hasRetryable) {
        ReminderRecoveryResult.Retry
    } else {
        ReminderRecoveryResult.PermanentFailure
    }
}
