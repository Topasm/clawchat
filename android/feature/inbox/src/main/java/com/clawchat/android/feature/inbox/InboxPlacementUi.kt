package com.clawchat.android.feature.inbox

import com.clawchat.android.core.data.model.ProjectNode
import com.clawchat.android.core.data.model.ProjectPlan
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

internal data class InboxParentOption(val id: String, val path: String)

/** Traverse the project's root task, never the first-class project ID. */
internal fun inboxParentOptions(project: ProjectPlan, nodes: List<ProjectNode>, taskId: String): List<InboxParentOption> {
    val root = project.rootTaskId ?: return emptyList()
    val children = nodes.groupBy { it.parentId }
    val visited = mutableSetOf<String>()
    val pending = ArrayDeque<Pair<String, String>>()
    pending.add(root to project.title)
    val result = mutableListOf<InboxParentOption>()
    while (pending.isNotEmpty()) {
        val (id, path) = pending.removeFirst()
        // Moving below ourselves or one of our descendants would create a cycle.
        if (id == taskId || !visited.add(id)) continue
        result.add(InboxParentOption(id, path))
        children[id].orEmpty().forEach { pending.add(it.id to "$path › ${it.title}") }
    }
    return result
}

internal fun inboxDisplayDate(value: String, locale: Locale): String =
    runCatching {
        LocalDate.parse(value.take(10)).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
    }.getOrDefault(value)
