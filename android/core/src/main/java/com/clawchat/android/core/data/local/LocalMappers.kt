package com.clawchat.android.core.data.local

import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.EventCreate
import com.clawchat.android.core.data.model.EventUpdate
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import java.time.ZoneId

fun TodoCreate.toLocalEntity(id: String, now: String, zoneId: ZoneId): LocalTodoEntity = LocalTodoEntity(
    id = id,
    title = title,
    description = description,
    dueDate = dueDate?.toStoredDueDate(zoneId),
    tags = tags?.joinToString(","),
    parentId = parentId,
    source = source,
    // Local mode has no AI pipeline, but captures still remain in Inbox until
    // the user explicitly schedules or otherwise organizes them.
    inboxState = inboxState ?: "none",
    createdAt = now,
    updatedAt = now,
)

fun LocalTodoEntity.applyUpdate(update: TodoUpdate, now: String, zoneId: ZoneId): LocalTodoEntity {
    val nextStatus = update.status?.wireValue ?: status
    val nextCompletedAt = when (update.status) {
        TaskStatus.COMPLETED -> completedAt ?: now
        TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED -> null
        null -> completedAt
    }
    return copy(
        title = update.title ?: title,
        description = update.description ?: description,
        status = nextStatus,
        dueDate = update.dueDate?.toStoredDueDate(zoneId) ?: dueDate,
        completedAt = nextCompletedAt,
        tags = update.tags?.joinToString(",") ?: tags,
        sortOrder = update.sortOrder ?: sortOrder,
        inboxState = update.inboxState ?: inboxState,
        updatedAt = now,
    )
}

fun LocalTodoEntity.toModel(): Todo = Todo(
    id = id,
    title = title,
    description = description,
    status = TaskStatus.fromWireValue(status),
    dueDate = dueDate,
    completedAt = completedAt,
    tags = tags?.split(",")?.filter(String::isNotBlank),
    parentId = parentId,
    sortOrder = sortOrder,
    source = source,
    inboxState = inboxState,
    syncStatus = "local",
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun EventCreate.toLocalEntity(id: String, now: String, zoneId: ZoneId): LocalEventEntity {
    val storedStart = startTime.toStoredEventTime(zoneId)
    return LocalEventEntity(
        id = id,
        title = title,
        description = description,
        startTime = storedStart.isoOffsetDateTime,
        startEpochMillis = storedStart.epochMillis,
        endTime = endTime?.toStoredEventTime(zoneId)?.isoOffsetDateTime,
        location = location,
        isAllDay = isAllDay,
        reminderMinutes = reminderMinutes,
        createdAt = now,
        updatedAt = now,
    )
}

fun LocalEventEntity.applyUpdate(
    update: EventUpdate,
    now: String,
    zoneId: ZoneId,
): LocalEventEntity {
    val storedStart = update.startTime?.toStoredEventTime(zoneId)
    return copy(
        title = update.title ?: title,
        description = update.description ?: description,
        startTime = storedStart?.isoOffsetDateTime ?: startTime,
        startEpochMillis = storedStart?.epochMillis ?: startEpochMillis,
        endTime = update.endTime?.toStoredEventTime(zoneId)?.isoOffsetDateTime ?: endTime,
        location = update.location ?: location,
        isAllDay = update.isAllDay ?: isAllDay,
        reminderMinutes = update.reminderMinutes ?: reminderMinutes,
        updatedAt = now,
    )
}

fun LocalEventEntity.toModel(): Event = Event(
    id = id,
    title = title,
    description = description,
    startTime = startTime,
    endTime = endTime,
    location = location,
    isAllDay = isAllDay,
    reminderMinutes = reminderMinutes,
    createdAt = createdAt,
    updatedAt = updatedAt,
)
