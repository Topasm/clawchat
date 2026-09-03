package com.clawchat.android.feature.planner

import com.clawchat.android.core.data.local.toStoredDueDate
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

data class WeekRange(
    val start: LocalDate,
    val endInclusive: LocalDate,
) {
    init {
        require(!endInclusive.isBefore(start))
    }

    operator fun contains(date: LocalDate): Boolean =
        !date.isBefore(start) && !date.isAfter(endInclusive)
}

fun weekRange(containing: LocalDate, firstDayOfWeek: DayOfWeek): WeekRange {
    val start = containing.with(TemporalAdjusters.previousOrSame(firstDayOfWeek))
    return WeekRange(start = start, endInclusive = start.plusDays(6))
}

internal data class WeekTaskGroups(
    val overdue: List<Todo>,
    val byDate: Map<LocalDate, List<Todo>>,
    /** The same work laid out as bars across the week's seven columns. */
    val spans: List<WeekTaskSpan> = emptyList(),
)

internal fun groupWeekTasks(
    todos: List<Todo>,
    range: WeekRange,
    zoneId: ZoneId,
    today: LocalDate = LocalDate.now(),
): WeekTaskGroups {
    val active = todos.asSequence()
        .filter { it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS }
        .filter { it.inboxState.isNullOrBlank() || it.inboxState == "none" }
        .mapNotNull { todo -> todo.dueLocalDate(zoneId)?.let { date -> date to todo } }
        .sortedWith(
            compareBy<Pair<LocalDate, Todo>>({ it.first }, { it.second.sortOrder }, { it.second.id }),
        )
        .toList()

    return WeekTaskGroups(
        overdue = active.filter { (date, _) -> date.isBefore(range.start) }.map { it.second },
        byDate = active
            .filter { (date, _) -> date in range }
            .groupBy(keySelector = { it.first }, valueTransform = { it.second }),
        spans = weekTaskSpans(todos, range, today, zoneId),
    )
}

internal fun Todo.dueLocalDate(zoneId: ZoneId): LocalDate? = dueDate?.let { raw ->
    runCatching { LocalDate.parse(raw.toStoredDueDate(zoneId)) }.getOrNull()
}

/** One task's stretch across the visible week, as column indices 0..6. */
internal data class WeekTaskSpan(
    val todo: Todo,
    val startIndex: Int,
    val endIndex: Int,
    val isOverdue: Boolean,
)

/**
 * Lay the week's deadlines out as spans, matching how the month grid draws
 * them: work runs from today through its due date, and an overdue task sits on
 * the day it was due because it has no stretch left to run.
 *
 * A deadline past the end of the week keeps its bar running to the week's edge
 * rather than disappearing, so a long piece of work still reads as ongoing.
 */
internal fun weekTaskSpans(
    todos: List<Todo>,
    range: WeekRange,
    today: LocalDate,
    zoneId: ZoneId,
): List<WeekTaskSpan> = todos.asSequence()
    .filter { it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS }
    .filter { it.inboxState.isNullOrBlank() || it.inboxState == "none" }
    .mapNotNull { todo -> todo.dueLocalDate(zoneId)?.let { due -> due to todo } }
    .sortedWith(compareBy({ it.first }, { it.second.sortOrder }, { it.second.id }))
    .mapNotNull { (due, todo) ->
        val isOverdue = due.isBefore(today)
        // Work runs from today to the deadline; an overdue task has no stretch
        // left, so it sits on the day it was due.
        val from = if (isOverdue) due else maxOf(today, range.start)
        val to = due
        if (to.isBefore(range.start) || from.isAfter(range.endInclusive)) return@mapNotNull null

        val startIndex = columnIndex(maxOf(from, range.start), range)
        val endIndex = columnIndex(minOf(to, range.endInclusive), range)
        WeekTaskSpan(
            todo = todo,
            startIndex = startIndex,
            endIndex = maxOf(startIndex, endIndex),
            isOverdue = isOverdue,
        )
    }
    .toList()

private fun columnIndex(date: LocalDate, range: WeekRange): Int =
    ChronoUnit.DAYS.between(range.start, date).toInt().coerceIn(0, 6)
