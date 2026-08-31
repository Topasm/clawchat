package com.clawchat.android.feature.planner

import com.clawchat.android.core.data.local.toStoredDueDate
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
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
)

internal fun groupWeekTasks(
    todos: List<Todo>,
    range: WeekRange,
    zoneId: ZoneId,
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
    )
}

internal fun Todo.dueLocalDate(zoneId: ZoneId): LocalDate? = dueDate?.let { raw ->
    runCatching { LocalDate.parse(raw.toStoredDueDate(zoneId)) }.getOrNull()
}
