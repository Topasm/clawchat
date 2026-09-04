package com.clawchat.android.core.data.local

import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo

fun Todo.toEntity(workspaceKey: String): TodoEntity = TodoEntity(
    workspaceKey = workspaceKey,
    id = id,
    title = title,
    description = description,
    projectId = projectId,
    status = status.wireValue,
    priority = priority,
    dueDate = dueDate,
    completedAt = completedAt,
    tags = tags?.joinToString(","),
    parentId = parentId,
    sortOrder = sortOrder,
    source = source,
    sourceId = sourceId,
    idempotencyKey = idempotencyKey,
    assignee = assignee,
    inboxState = inboxState ?: "none",
    estimatedMinutes = estimatedMinutes,
    projectLabel = projectLabel,
    isRecurring = isRecurring,
    recurrenceRule = recurrenceRule,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun TodoEntity.toModel(): Todo = Todo(
    id = id,
    title = title,
    description = description,
    projectId = projectId,
    status = TaskStatus.fromWireValue(status),
    priority = priority,
    dueDate = dueDate,
    completedAt = completedAt,
    tags = tags?.split(",")?.filter { it.isNotBlank() },
    parentId = parentId,
    sortOrder = sortOrder,
    source = source,
    sourceId = sourceId,
    idempotencyKey = idempotencyKey,
    assignee = assignee,
    inboxState = inboxState,
    estimatedMinutes = estimatedMinutes,
    projectLabel = projectLabel,
    isRecurring = isRecurring,
    recurrenceRule = recurrenceRule,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun Event.toEntity(workspaceKey: String): EventEntity = EventEntity(
    workspaceKey = workspaceKey,
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

fun EventEntity.toModel(): Event = Event(
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
