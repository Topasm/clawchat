package com.clawchat.android.core.ui

import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration

@Immutable
data class TaskCompletionUiState(
    val alpha: Float,
    val titleColor: Color,
    val textDecoration: TextDecoration?,
)

@Composable
fun rememberTaskCompletionUiState(isCompleted: Boolean): TaskCompletionUiState {
    val completionAlpha by animateFloatAsState(
        targetValue = if (isCompleted) 0.5f else 1f,
        animationSpec = tween(durationMillis = 300),
        label = "task_alpha",
    )
    val titleColor by animateColorAsState(
        targetValue = if (isCompleted) {
            MaterialTheme.colorScheme.onSurfaceVariant
        } else {
            MaterialTheme.colorScheme.onSurface
        },
        animationSpec = tween(durationMillis = 300),
        label = "title_color",
    )

    return TaskCompletionUiState(
        alpha = completionAlpha,
        titleColor = titleColor,
        textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
    )
}

fun performTaskToggleHaptic(view: View) {
    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
}
