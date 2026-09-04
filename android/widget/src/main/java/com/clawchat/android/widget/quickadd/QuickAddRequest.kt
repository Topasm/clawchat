package com.clawchat.android.widget.quickadd

import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.QuickCaptureParser

internal object QuickAddRequestFactory {
    fun create(
        title: String,
        idempotencyKey: String,
    ): TodoCreate? {
        if (idempotencyKey.isBlank()) return null
        return QuickCaptureParser.parse(title)?.toTodoCreate(
            source = "android_widget",
            idempotencyKey = idempotencyKey,
        )
    }
}
