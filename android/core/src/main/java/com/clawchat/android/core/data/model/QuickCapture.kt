package com.clawchat.android.core.data.model

/**
 * Metadata that can be expressed without turning Inbox capture into a form.
 * Dates are deliberately not inferred: the current API only has a deadline,
 * and ordinary phrases such as "today" must not silently create one.
 */
data class QuickCaptureDraft(
    val title: String,
    val priority: String = DEFAULT_PRIORITY,
    val tags: List<String> = emptyList(),
) {
    fun toTodoCreate(
        source: String,
        idempotencyKey: String,
    ): TodoCreate = TodoCreate(
        title = title,
        priority = priority,
        tags = tags.takeIf(List<String>::isNotEmpty),
        source = source,
        inboxState = "captured",
        idempotencyKey = idempotencyKey,
    )

    companion object {
        const val DEFAULT_PRIORITY = "medium"
    }
}

/** Conservative, offline parser for explicit one-token capture hints. */
object QuickCaptureParser {
    private val tokenPattern = Regex(
        pattern = """(?<!\S)(#[\p{L}\p{N}_-]+|!(?:high|medium|low|높음|보통|낮음))(?=\s|$)""",
        option = RegexOption.IGNORE_CASE,
    )
    private val whitespace = Regex("""\s+""")

    fun parse(raw: String): QuickCaptureDraft? {
        val normalized = raw.trim()
        if (normalized.isEmpty()) return null

        var priority = QuickCaptureDraft.DEFAULT_PRIORITY
        val tags = linkedMapOf<String, String>()
        tokenPattern.findAll(normalized).forEach { match ->
            val token = match.value
            if (token.startsWith('#')) {
                val tag = token.drop(1)
                tags.putIfAbsent(tag.lowercase(), tag)
            } else {
                priority = token.drop(1).lowercase().toPriority()
            }
        }

        val title = tokenPattern.replace(normalized, " ")
            .replace(whitespace, " ")
            .trim()
        if (title.isEmpty()) return null

        return QuickCaptureDraft(
            title = title,
            priority = priority,
            tags = tags.values.toList(),
        )
    }
}

private fun String.toPriority(): String = when (this) {
    "high", "높음" -> "high"
    "low", "낮음" -> "low"
    else -> QuickCaptureDraft.DEFAULT_PRIORITY
}
