package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/** What the tracking widget can be showing: open tasks or recent notes. */
internal sealed interface TrackingWidgetData

/** Small, deterministic projection used by the Glance UI. */
internal data class TodoWidgetUiModel(
    /** Overdue work and everything due within the horizon, soonest first. */
    val deadlines: List<TodoWidgetItem>,
    /** In-progress work and undated tasks, which have no runway to draw. */
    val others: List<TodoWidgetItem> = emptyList(),
    /** The first deadline past the horizon that no row already shows. */
    val nextDeadline: NextDeadline? = null,
) : TrackingWidgetData {
    val items: List<TodoWidgetItem>
        get() = deadlines + others

    val itemCount: Int
        get() = deadlines.size + others.size

    val isEmpty: Boolean
        get() = itemCount == 0

    companion object {
        /**
         * Undated work can be a whole backlog; the widget stays a glance
         * surface by showing only the most recently touched of it.
         */
        const val MAX_OTHER_ROWS = 20

        /**
         * Project tasks onto the widget's runway: everything already overdue,
         * plus everything due within [horizonDays], soonest deadline first.
         *
         * Below the runway come the tasks a deadline list would hide: work
         * already in progress whatever its due date, then undated tasks. An
         * empty widget read as broken when the only open task was due a few
         * weeks out, so a pending deadline past the horizon is kept as
         * [nextDeadline] for the widget to name.
         */
        fun from(
            todos: List<Todo>,
            horizonDays: Int,
            today: LocalDate = LocalDate.now(),
            deviceZone: ZoneId = ZoneId.systemDefault(),
        ): TodoWidgetUiModel {
            val horizonEnd = today.plusDays(horizonDays.toLong())
            val seenIds = mutableSetOf<String>()
            val deadlines = mutableListOf<TodoWidgetItem>()
            val others = mutableListOf<Pair<TodoWidgetItem, String>>()
            var nextDeadline: NextDeadline? = null

            todos.asSequence()
                .filter { it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS }
                // Inbox captures have not been triaged into work yet.
                .filter { it.inboxState == null || it.inboxState == "none" }
                .filter { seenIds.add(it.id) }
                .forEach { todo ->
                    val inProgress = todo.status == TaskStatus.IN_PROGRESS
                    val due = widgetDueDate(todo.dueDate, deviceZone)
                    val daysRemaining = due?.let { ChronoUnit.DAYS.between(today, it).toInt() }
                    when {
                        due != null && daysRemaining != null && !due.isAfter(horizonEnd) ->
                            deadlines += TodoWidgetItem(
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
                                inProgress = inProgress,
                            )
                        inProgress || due == null ->
                            others += TodoWidgetItem(
                                id = todo.id,
                                title = todo.title,
                                daysRemaining = daysRemaining,
                                runwayFraction = null,
                                inProgress = inProgress,
                            ) to todo.updatedAt
                        daysRemaining != null -> {
                            val current = nextDeadline
                            if (current == null ||
                                daysRemaining < current.daysRemaining ||
                                (daysRemaining == current.daysRemaining && todo.title < current.title)
                            ) {
                                nextDeadline = NextDeadline(todo.title, due, daysRemaining)
                            }
                        }
                    }
                }

            return TodoWidgetUiModel(
                deadlines = deadlines.sortedWith(compareBy({ it.daysRemaining }, { it.title })),
                others = others
                    .sortedWith(
                        compareBy<Pair<TodoWidgetItem, String>> { !it.first.inProgress }
                            .thenBy { it.first.daysRemaining ?: Int.MAX_VALUE }
                            // ISO timestamps order as strings; newest first.
                            .thenByDescending { it.second }
                            .thenBy { it.first.title },
                    )
                    .take(MAX_OTHER_ROWS)
                    .map { it.first },
                nextDeadline = nextDeadline,
            )
        }
    }
}

internal data class TodoWidgetItem(
    val id: String,
    val title: String,
    /** Negative once the deadline has passed, 0 on the day it is due, null when undated. */
    val daysRemaining: Int?,
    /** How much of the horizon is left, 0f..1f; null for rows outside the runway. */
    val runwayFraction: Float?,
    val inProgress: Boolean = false,
) {
    val isOverdue: Boolean
        get() = daysRemaining != null && daysRemaining < 0
}

internal data class NextDeadline(
    val title: String,
    val dueDate: LocalDate,
    val daysRemaining: Int,
)

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
