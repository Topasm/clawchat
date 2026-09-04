package com.clawchat.android.core.ui

import android.view.HapticFeedbackConstants
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.gestures.animateTo
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.R
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * Shared swipe-action background used across Today and Tasks screens.
 * Swiping left reveals a delete button; swiping right still applies due-today.
 */
@Composable
private fun SwipeBackground(
    modifier: Modifier = Modifier,
    offset: Float,
    onDelete: () -> Unit,
) {
    val color by animateColorAsState(
        when {
            offset < 0f -> MaterialTheme.colorScheme.error.copy(alpha = 0.14f)
            offset > 0f -> MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
            else -> Color.Transparent
        },
        label = "swipe_bg_color",
    )

    Box(
        modifier = modifier.background(color, MaterialTheme.shapes.extraSmall),
    ) {
        if (offset > 0f) {
            Icon(
                Icons.Default.DateRange,
                contentDescription = stringResource(R.string.task_swipe_due_today),
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .padding(horizontal = 14.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        if (offset < 0f) {
            IconButton(
                onClick = onDelete,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .width(SWIPE_ACTION_WIDTH),
            ) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = stringResource(R.string.common_swipe_delete),
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

/**
 * Shared swipe-action wrapper. Swipe left and tap the revealed delete button to
 * confirm deletion. Swipe right continues to set the task due today.
 */
@Composable
fun SwipeToDismissCard(
    onDelete: () -> Unit,
    onSetDueToday: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val actionWidthPx = with(LocalDensity.current) { SWIPE_ACTION_WIDTH.toPx() }
    val swipeState = remember { AnchoredDraggableState(SwipeCardAnchor.Settled) }

    LaunchedEffect(actionWidthPx, onSetDueToday != null) {
        swipeState.updateAnchors(
            DraggableAnchors {
                SwipeCardAnchor.Settled at 0f
                SwipeCardAnchor.DeleteRevealed at -actionWidthPx
                if (onSetDueToday != null) {
                    SwipeCardAnchor.DueToday at actionWidthPx
                }
            },
        )
    }

    LaunchedEffect(swipeState.settledValue) {
        when (swipeState.settledValue) {
            SwipeCardAnchor.DueToday -> {
                view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                onSetDueToday?.invoke()
                swipeState.animateTo(SwipeCardAnchor.Settled)
            }
            SwipeCardAnchor.DeleteRevealed,
            SwipeCardAnchor.Settled,
            -> Unit
        }
    }

    val offset = swipeState.offset.takeUnless(Float::isNaN) ?: 0f
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.extraSmall),
    ) {
        SwipeBackground(
            modifier = Modifier.matchParentSize(),
            offset = offset,
            onDelete = {
                view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                onDelete()
                scope.launch { swipeState.animateTo(SwipeCardAnchor.Settled) }
            },
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .offset { IntOffset(offset.roundToInt(), 0) }
                .anchoredDraggable(
                    state = swipeState,
                    orientation = Orientation.Horizontal,
                ),
        ) {
            content()
        }
    }
}

private enum class SwipeCardAnchor { Settled, DeleteRevealed, DueToday }

private val SWIPE_ACTION_WIDTH = 72.dp
