package com.clawchat.android.widget.quickadd

import com.clawchat.android.core.data.model.TodoCreate
import java.time.LocalDate

enum class QuickAddTarget(val wireValue: String) {
    TODAY("today"),
    INBOX("inbox"),
    ;

    companion object {
        fun fromWireValue(value: String?): QuickAddTarget =
            entries.firstOrNull { it.wireValue == value } ?: INBOX
    }
}

internal object QuickAddRequestFactory {
    fun create(
        title: String,
        target: QuickAddTarget,
        idempotencyKey: String,
        today: LocalDate = LocalDate.now(),
    ): TodoCreate? {
        val normalizedTitle = title.trim()
        if (normalizedTitle.isEmpty() || idempotencyKey.isBlank()) return null

        return TodoCreate(
            title = normalizedTitle,
            dueDate = if (target == QuickAddTarget.TODAY) today.toString() else null,
            source = "android_widget",
            inboxState = if (target == QuickAddTarget.INBOX) "captured" else "none",
            idempotencyKey = idempotencyKey,
        )
    }
}
