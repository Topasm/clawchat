package com.clawchat.android.feature.chat

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive

private val fastRefreshStatuses = setOf("queued", "starting", "running", "waiting_input", "waiting_review")

/** Called inside repeatOnLifecycle so leaving the screen cancels both the timer and subscription. */
internal suspend fun StateFlow<ChatUiState>.pollConversation(refresh: () -> Unit) {
    refresh()
    map { it.refreshIntervalMillis() }.distinctUntilChanged().collectLatest { interval ->
        while (currentCoroutineContext().isActive) {
            delay(interval)
            refresh()
        }
    }
}

/** Messages are chronological. Old running cards must not keep completed runs polling quickly. */
internal fun ChatUiState.refreshIntervalMillis(): Long {
    if (error != null) return 30_000L
    val statuses = mutableMapOf<String, String>()
    for (message in messages) {
        message.taskDelegation?.runId?.let { statuses.putIfAbsent(it, "queued") }
        message.runUpdate?.let { update ->
            update.runId?.let { statuses[it] = update.status }
        }
    }
    return if (statuses.values.any { it in fastRefreshStatuses }) 5_000L else 30_000L
}
