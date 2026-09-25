package com.clawchat.android.widget.common

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/** Finish refreshing healthy instances even if another widget was removed or fails. */
internal suspend fun refreshWidgetsIndependently(updates: List<suspend () -> Unit>) {
    coroutineScope {
        val failures = updates.map { update ->
            async {
                try {
                    update()
                    null
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    error
                }
            }
        }.awaitAll().filterNotNull()

        // Keep the failure visible to the caller after all other instances finish.
        failures.firstOrNull()?.let { first ->
            failures.drop(1).filter { it !== first }.forEach(first::addSuppressed)
            throw first
        }
    }
}
