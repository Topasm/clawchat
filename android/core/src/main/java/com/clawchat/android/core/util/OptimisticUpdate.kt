package com.clawchat.android.core.util

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

/**
 * Applies an optimistic UI update, then executes the API call.
 * On failure, rolls back using the captured previous state.
 */
suspend fun <S> MutableStateFlow<S>.optimistic(
    update: (S) -> S,
    rollback: (S) -> S = { it },
    action: suspend () -> Unit,
) {
    this.update(update)
    try {
        action()
    } catch (e: Exception) {
        this.update(rollback)
        throw e
    }
}
