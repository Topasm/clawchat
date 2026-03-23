package com.clawchat.android.core.data.local

import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.Todo

fun Todo.toEntity(): TodoEntity = TodoEntity(
    id = id,
    title = title,
    description = description,
    status = status,
    priority = priority,
    dueDate = dueDate,
    completedAt = completedAt,
    tags = tags?.joinToString(","),
    parentId = parentId,
    sortOrder = sortOrder,
    inboxState = inboxState ?: "none",
    isRecurring = isRecurring,
    recurrenceRule = recurrenceRule,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun TodoEntity.toModel(): Todo = Todo(
    id = id,
    title = title,
    description = description,
    status = status,
    priority = priority,
    dueDate = dueDate,
    completedAt = completedAt,
    tags = tags?.split(",")?.filter { it.isNotBlank() },
    parentId = parentId,
    sortOrder = sortOrder,
    inboxState = inboxState,
    isRecurring = isRecurring,
    recurrenceRule = recurrenceRule,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun Event.toEntity(): EventEntity = EventEntity(
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
