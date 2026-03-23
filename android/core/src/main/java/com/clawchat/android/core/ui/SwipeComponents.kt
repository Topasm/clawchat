package com.clawchat.android.core.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxState
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import android.view.HapticFeedbackConstants

/**
 * Shared swipe-to-dismiss background used across Today and Tasks screens.
 * Swipe left (EndToStart) shows delete (red), swipe right (StartToEnd) shows set-due-today (primary).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeBackground(dismissState: SwipeToDismissBoxState) {
    val color by animateColorAsState(
        when (dismissState.targetValue) {
            SwipeToDismissBoxValue.EndToStart -> MaterialTheme.colorScheme.error.copy(alpha = 0.14f)
            SwipeToDismissBoxValue.StartToEnd -> MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
            SwipeToDismissBoxValue.Settled -> Color.Transparent
        },
        label = "swipe_bg_color",
    )
    val alignment = when (dismissState.dismissDirection) {
        SwipeToDismissBoxValue.EndToStart -> Alignment.CenterEnd
        SwipeToDismissBoxValue.StartToEnd -> Alignment.CenterStart
        else -> Alignment.Center
    }
    val icon = when (dismissState.dismissDirection) {
        SwipeToDismissBoxValue.EndToStart -> Icons.Default.Delete
        SwipeToDismissBoxValue.StartToEnd -> Icons.Default.DateRange
        else -> null
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(color, RoundedCornerShape(24.dp))
            .padding(horizontal = 20.dp),
        contentAlignment = alignment,
    ) {
        if (icon != null) {
            Icon(
                icon,
                contentDescription = null,
                tint = when (dismissState.dismissDirection) {
                    SwipeToDismissBoxValue.EndToStart -> MaterialTheme.colorScheme.error
                    SwipeToDismissBoxValue.StartToEnd -> MaterialTheme.colorScheme.primary
                    else -> Color.White
                },
            )
        }
    }
}

/**
 * Shared swipe-to-dismiss wrapper. Swipe left to delete, swipe right to set due today.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeToDismissCard(
    onDelete: () -> Unit,
    onSetDueToday: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.EndToStart -> {
                    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    onDelete()
                    true
                }
                SwipeToDismissBoxValue.StartToEnd -> {
                    if (onSetDueToday == null) {
                        false
                    } else {
                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                        onSetDueToday()
                        false
                    }
                }
                SwipeToDismissBoxValue.Settled -> false
            }
        },
    )

    SwipeToDismissBox(
        state = dismissState,
        backgroundContent = { SwipeBackground(dismissState) },
        enableDismissFromEndToStart = true,
        enableDismissFromStartToEnd = onSetDueToday != null,
    ) {
        content()
    }
}
