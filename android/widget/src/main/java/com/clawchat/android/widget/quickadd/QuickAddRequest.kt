package com.clawchat.android.widget.quickadd

import com.clawchat.android.core.data.model.TodoCreate

internal object QuickAddRequestFactory {
    fun create(
        title: String,
        idempotencyKey: String,
    ): TodoCreate? {
        val normalizedTitle = title.trim()
        if (normalizedTitle.isEmpty() || idempotencyKey.isBlank()) return null

        return TodoCreate(
            title = normalizedTitle,
            source = "android_widget",
            // A widget interaction is a capture, not a scheduling decision.
            // The user can promote it to Today from Inbox after reviewing it.
            inboxState = "captured",
            idempotencyKey = idempotencyKey,
        )
    }
}
