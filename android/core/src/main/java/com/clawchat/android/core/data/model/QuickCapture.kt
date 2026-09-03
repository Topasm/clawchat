package com.clawchat.android.core.data.model

/**
 * Metadata that can be expressed without turning Inbox capture into a form.
 * Dates are deliberately not inferred: the current API only has a deadline,
 * and ordinary phrases such as "today" must not silently create one.
 */
data class QuickCaptureDraft(
    val title: String,
    val tags: List<String> = emptyList(),
) {
    fun toTodoCreate(
        source: String,
        idempotencyKey: String,
    ): TodoCreate = TodoCreate(
        title = title,
        tags = tags.takeIf(List<String>::isNotEmpty),
        source = source,
        inboxState = "captured",
        idempotencyKey = idempotencyKey,
    )
}

/** Conservative, offline parser for explicit one-token capture hints. */
object QuickCaptureParser {
    private val tokenPattern = Regex(
        pattern = """(?<!\S)(#[\p{L}\p{N}_-]+)(?=\s|$)""",
        option = RegexOption.IGNORE_CASE,
    )
    private val whitespace = Regex("""\s+""")

    fun parse(raw: String): QuickCaptureDraft? {
        val normalized = raw.trim()
        if (normalized.isEmpty()) return null

        val tags = linkedMapOf<String, String>()
        tokenPattern.findAll(normalized).forEach { match ->
            val tag = match.value.drop(1)
            tags.putIfAbsent(tag.lowercase(), tag)
        }

        val title = tokenPattern.replace(normalized, " ")
            .replace(whitespace, " ")
            .trim()
        if (title.isEmpty()) return null

        return QuickCaptureDraft(
            title = title,
            tags = tags.values.toList(),
        )
    }
}
