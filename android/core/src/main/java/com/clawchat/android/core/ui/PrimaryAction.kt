package com.clawchat.android.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.staticCompositionLocalOf

/** What the one + button adds on the screen that is showing. */
data class PrimaryAction(val contentDescription: String, val onClick: () -> Unit)

/**
 * The one + button: a list screen registers what it adds while it is on
 * screen, and the button is hosted once above the navigation graph. The
 * newest registration wins and unregistering restores the previous one,
 * which matters while two pages are composed at once, as during a planner
 * swipe or a navigation transition.
 */
class PrimaryActionHost {
    private val stack = mutableStateListOf<Pair<String, PrimaryAction>>()

    val action: PrimaryAction?
        get() = stack.lastOrNull()?.second

    fun register(key: String, action: PrimaryAction) {
        stack.removeAll { it.first == key }
        stack.add(key to action)
    }

    fun unregister(key: String) {
        stack.removeAll { it.first == key }
    }
}

val LocalPrimaryActionHost = staticCompositionLocalOf<PrimaryActionHost?> { null }

/**
 * Registers [onClick] as the + button's action while this composable is on
 * screen. Call it from the list, not the detail, so the button disappears
 * when a detail view takes over.
 */
@Composable
fun RegisterPrimaryAction(key: String, contentDescription: String, onClick: () -> Unit) {
    val host = LocalPrimaryActionHost.current
    val latest = rememberUpdatedState(onClick)
    DisposableEffect(host, key, contentDescription) {
        host?.register(key, PrimaryAction(contentDescription) { latest.value() })
        onDispose { host?.unregister(key) }
    }
}
