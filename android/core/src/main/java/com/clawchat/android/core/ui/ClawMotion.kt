package com.clawchat.android.core.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * One set of durations and easings, so every screen moves the same way.
 *
 * Motion is quiet on purpose: short fades with a small horizontal drift that
 * says "this came from there", never a full-width slide.
 */
object ClawMotion {
    const val EnterMillis = 240
    const val ExitMillis = 160
    const val QuickMillis = 120

    /** How far a surface drifts in, as a fraction of its width (1/12). */
    private const val DRIFT = 12

    fun navEnter(): EnterTransition =
        fadeIn(tween(EnterMillis, easing = FastOutSlowInEasing)) +
            slideInHorizontally(tween(EnterMillis, easing = FastOutSlowInEasing)) { it / DRIFT }

    fun navExit(): ExitTransition = fadeOut(tween(ExitMillis))

    fun navPopEnter(): EnterTransition =
        fadeIn(tween(EnterMillis, easing = FastOutSlowInEasing)) +
            slideInHorizontally(tween(EnterMillis, easing = FastOutSlowInEasing)) { -it / DRIFT }

    fun navPopExit(): ExitTransition =
        fadeOut(tween(ExitMillis)) +
            slideOutHorizontally(tween(ExitMillis, easing = FastOutSlowInEasing)) { it / DRIFT }
}

/**
 * Swaps between two states of one screen (a list and the detail it opens, or
 * two modes behind a toggle) with a fade and a small drift, instead of an
 * instant cut.
 *
 * [forward] decides the drift direction: true drifts the new content in from
 * the end (opening), false from the start (going back).
 */
@Composable
fun <T> ClawCrossfade(
    targetState: T,
    modifier: Modifier = Modifier,
    label: String = "ClawCrossfade",
    contentKey: (T) -> Any? = { it },
    forward: (initial: T, target: T) -> Boolean = { _, _ -> true },
    content: @Composable (T) -> Unit,
) {
    AnimatedContent(
        targetState = targetState,
        modifier = modifier,
        transitionSpec = {
            val goingForward = forward(initialState, targetState)
            val enter = fadeIn(tween(ClawMotion.EnterMillis, easing = FastOutSlowInEasing)) +
                slideInHorizontally(tween(ClawMotion.EnterMillis, easing = FastOutSlowInEasing)) {
                    if (goingForward) it / 12 else -it / 12
                }
            val exit = fadeOut(tween(ClawMotion.ExitMillis))
            (enter togetherWith exit).using(SizeTransform(clip = false))
        },
        label = label,
        contentKey = contentKey,
    ) { state ->
        content(state)
    }
}

/** Expand/collapse that grows the content into place instead of popping it. */
@Composable
fun ClawExpand(
    visible: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(tween(ClawMotion.EnterMillis)) +
            expandVertically(tween(ClawMotion.EnterMillis, easing = FastOutSlowInEasing)),
        exit = fadeOut(tween(ClawMotion.QuickMillis)) +
            shrinkVertically(tween(ClawMotion.ExitMillis, easing = FastOutSlowInEasing)),
    ) {
        Column(content = content)
    }
}
