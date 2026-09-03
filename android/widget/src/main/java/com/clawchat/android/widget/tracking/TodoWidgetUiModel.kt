package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/** Small, deterministic projection used by the Glance UI. */
internal data class TodoWidgetUiModel(
    val items: List<TodoWidgetItem>,
) {
    val itemCount: Int
        get() = items.size

    val isEmpty: Boolean
        get() = items.isEmpty()

    companion object {
        /**
         * Project tasks onto the widget's runway: everything already overdue,
         * plus everything due within [horizonDays], soonest deadline first.
         *
         * Ordering by deadline is what lets the list be read without headings.
         * A task appears while there is still room to work towards it rather
         * than on the morning it is due, which is the point at which nothing
         * can be rearranged any more.
         */
        fun from(
            todos: List<Todo>,
            horizonDays: Int,
            today: LocalDate = LocalDate.now(),
            deviceZone: ZoneId = ZoneId.systemDefault(),
        ): TodoWidgetUiModel {
            val horizonEnd = today.plusDays(horizonDays.toLong())
            val seenIds = mutableSetOf<String>()

            val items = todos.asSequence()
                .filter { it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS }
                // Inbox captures have not been triaged into work yet.
                .filter { it.inboxState == null || it.inboxState == "none" }
                .filter { seenIds.add(it.id) }
                .mapNotNull { todo ->
                    val due = widgetDueDate(todo.dueDate, deviceZone) ?: return@mapNotNull null
                    if (due.isAfter(horizonEnd)) return@mapNotNull null
                    val daysRemaining = ChronoUnit.DAYS.between(today, due).toInt()
                    TodoWidgetItem(
                        id = todo.id,
                        title = todo.title,
                        daysRemaining = daysRemaining,
                        // Nothing is left of an overdue task's runway, so its
                        // line is drawn full rather than empty: past the line,
                        // not approaching it.
                        runwayFraction = if (daysRemaining < 0) {
                            1f
                        } else {
                            (daysRemaining.toFloat() / horizonDays.coerceAtLeast(1)).coerceIn(0f, 1f)
                        },
                        isHighPriority = todo.priority == "high" || todo.priority == "urgent",
                    )
                }
                .sortedWith(compareBy({ it.daysRemaining }, { it.title }))
                .toList()

            return TodoWidgetUiModel(items = items)
        }
    }
}

internal data class TodoWidgetItem(
    val id: String,
    val title: String,
    /** Negative once the deadline has passed, 0 on the day it is due. */
    val daysRemaining: Int,
    /** How much of the horizon is left, 0f..1f. */
    val runwayFraction: Float,
    val isHighPriority: Boolean,
) {
    val isOverdue: Boolean
        get() = daysRemaining < 0
}

/** Reads a stored deadline as the day it falls on, or null when unreadable. */
internal fun widgetDueDate(raw: String?, deviceZone: ZoneId): LocalDate? {
    val value = raw?.trim().orEmpty()
    if (value.isEmpty()) return null
    return runCatching {
        ZonedDateTime.parse(value).withZoneSameInstant(deviceZone).toLocalDate()
    }
        .recoverCatching {
            OffsetDateTime.parse(value).atZoneSameInstant(deviceZone).toLocalDate()
        }
        .recoverCatching { LocalDateTime.parse(value).toLocalDate() }
        .recoverCatching { LocalDate.parse(value.take(10)) }
        .getOrNull()
}
