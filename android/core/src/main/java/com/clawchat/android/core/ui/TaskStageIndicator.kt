package com.clawchat.android.core.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.R
import com.clawchat.android.core.data.model.TaskStage
import com.clawchat.android.core.data.model.TaskStageException
import com.clawchat.android.core.data.model.TaskStageState

@StringRes
fun TaskStage.labelRes(): Int = when (this) {
    TaskStage.CAPTURE -> R.string.task_stage_capture
    TaskStage.PLAN -> R.string.task_stage_plan
    TaskStage.RUN -> R.string.task_stage_run
    TaskStage.REVIEW -> R.string.task_stage_review
    TaskStage.DONE -> R.string.task_stage_done
}

@StringRes
fun TaskStageException.labelRes(): Int = when (this) {
    TaskStageException.NEEDS_INPUT -> R.string.task_stage_needs_input
    TaskStageException.FAILED -> R.string.task_stage_failed
}

/** One short phrase for the whole state, for a list row or a screen reader. */
@StringRes
fun TaskStageState.describeRes(): Int = when {
    cancelled -> R.string.task_stage_cancelled
    exception != null -> exception.labelRes()
    else -> stage.labelRes()
}

private enum class StepPosition { PAST, CURRENT, NEXT }

private fun TaskStageState.position(step: TaskStage): StepPosition = when {
    step.ordinal < stage.ordinal -> StepPosition.PAST
    step == stage -> StepPosition.CURRENT
    else -> StepPosition.NEXT
}

@Composable
private fun stageSummary(state: TaskStageState, label: String): String =
    stringResource(R.string.task_stage_summary, state.stage.ordinal + 1, label)

/** Amber for "needs input": the theme's tertiary. */
@Composable
private fun needsInputColor(): Color =
    MaterialTheme.colorScheme.tertiary

/**
 * Colour of the current step's mark. In a list every row has a current step,
 * so [accent] is null there and the mark is drawn in ink; the task page passes
 * the accent so its one current step stands out.
 */
@Composable
private fun currentMarkColor(state: TaskStageState, accent: Color?): Color = when {
    state.cancelled -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
    state.exception == TaskStageException.NEEDS_INPUT -> needsInputColor()
    state.exception == TaskStageException.FAILED -> MaterialTheme.colorScheme.error
    else -> accent ?: MaterialTheme.colorScheme.onSurface
}

/**
 * Where a task is among Captured → Plan → Run → Review → Done, for a list
 * row: five small marks and one word. [label] replaces the step's own word.
 */
@Composable
fun TaskStageDots(
    state: TaskStageState,
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    val text = label ?: stringResource(state.describeRes())
    val summary = stageSummary(state, text)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val current = currentMarkColor(state, accent = null)
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = summary },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            TaskStage.entries.forEach { step ->
                val dot = Modifier.size(6.dp)
                when (state.position(step)) {
                    StepPosition.PAST -> Box(dot.background(muted.copy(alpha = 0.55f), CircleShape))
                    StepPosition.CURRENT -> Box(dot.background(current, CircleShape))
                    StepPosition.NEXT -> Box(dot.border(1.dp, muted.copy(alpha = 0.6f), CircleShape))
                }
            }
        }
        val flagged = state.exception != null && !state.cancelled
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (flagged) FontWeight.SemiBold else FontWeight.Medium,
            color = if (flagged) MaterialTheme.colorScheme.onSurface else muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The labelled five-step bar for a task or run page. Only the current step
 * carries the accent; a step behind it is plain, a step ahead is hollow.
 * Needing an answer or having failed sits on the current step as a badge
 * instead of becoming a sixth step.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TaskStageBar(
    state: TaskStageState,
    modifier: Modifier = Modifier,
) {
    val summary = stageSummary(state, stringResource(state.describeRes()))
    val scheme = MaterialTheme.colorScheme
    val current = currentMarkColor(state, accent = scheme.primary)
    FlowRow(
        modifier = modifier.clearAndSetSemantics { contentDescription = summary },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        TaskStage.entries.forEach { step ->
            val position = state.position(step)
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (step.ordinal > 0) {
                    Box(Modifier.width(8.dp).height(1.dp).background(scheme.outline))
                }
                val mark = Modifier.size(18.dp)
                val showCheck = position == StepPosition.PAST ||
                    (position == StepPosition.CURRENT && step == TaskStage.DONE)
                Box(
                    modifier = when (position) {
                        StepPosition.PAST -> mark.background(scheme.surfaceContainerHigh, CircleShape)
                        StepPosition.CURRENT -> mark.background(current, CircleShape)
                        StepPosition.NEXT -> mark.border(1.dp, scheme.outline, CircleShape)
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    val markContent = when (position) {
                        StepPosition.CURRENT -> scheme.surface
                        else -> scheme.onSurfaceVariant
                    }
                    if (showCheck) {
                        Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(12.dp), tint = markContent)
                    } else {
                        Text(
                            text = (step.ordinal + 1).toString(),
                            style = MaterialTheme.typography.labelSmall,
                            color = markContent,
                        )
                    }
                }
                Text(
                    text = stringResource(step.labelRes()),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = if (position == StepPosition.CURRENT) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (position == StepPosition.NEXT) scheme.onSurfaceVariant else scheme.onSurface,
                )
                if (position == StepPosition.CURRENT) {
                    val exception = state.exception
                    when {
                        state.cancelled -> StageBadge(stringResource(R.string.task_stage_cancelled), scheme.surfaceContainerHigh, scheme.onSurfaceVariant)
                        exception == TaskStageException.NEEDS_INPUT -> StageBadge(
                            stringResource(exception.labelRes()),
                            needsInputColor().copy(alpha = 0.16f),
                            scheme.onSurface,
                        )
                        exception == TaskStageException.FAILED -> StageBadge(
                            stringResource(exception.labelRes()),
                            scheme.error.copy(alpha = 0.12f),
                            scheme.error,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StageBadge(text: String, container: Color, content: Color) {
    Text(
        text = text,
        modifier = Modifier
            .background(container, MaterialTheme.shapes.extraSmall)
            .padding(horizontal = 6.dp, vertical = 1.dp),
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Medium,
        color = content,
    )
}
