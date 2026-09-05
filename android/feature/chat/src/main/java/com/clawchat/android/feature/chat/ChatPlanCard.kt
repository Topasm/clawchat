package com.clawchat.android.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.model.ChatPlanProposal

/** A proposal stays read-only until the user explicitly applies its revision. */
@Composable
internal fun ChatPlanCard(
    plan: ChatPlanProposal?,
    pending: Boolean,
    canUndo: Boolean,
    parentTitle: String?,
    onAction: (String) -> Unit,
) {
    var expanded by rememberSaveable(plan?.id, plan?.status) { mutableStateOf(false) }
    Card {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.chat_plan_title), style = MaterialTheme.typography.titleSmall)
            parentTitle?.let { Text(stringResource(R.string.chat_plan_parent, it)) }
            if (plan == null) {
                Text(stringResource(R.string.chat_plan_unavailable))
                return@Column
            }
            plan.summary?.let { Text(it, maxLines = if (expanded) Int.MAX_VALUE else 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
            Text(stringResource(when (plan.status) {
                "draft" -> R.string.chat_plan_draft
                "applied" -> R.string.chat_plan_applied
                "rejected" -> R.string.chat_plan_dismissed
                "generating" -> R.string.chat_plan_generating
                "applying" -> R.string.chat_plan_applying
                "reverted" -> R.string.chat_plan_reverted
                "failed" -> R.string.chat_plan_failed
                else -> R.string.chat_plan_stale
            }))
            TextButton(onClick = { expanded = !expanded }) {
                Text(stringResource(if (expanded) R.string.chat_plan_hide_details else R.string.chat_plan_review_details, plan.subtasks.size))
            }
            if (!expanded && plan.diff.rootFields.isNotEmpty()) Text(stringResource(R.string.chat_plan_root_changes))
            if (expanded) {
            plan.subtasks.forEachIndexed { index, step ->
                Text("${index + 1}. ${step.title}", style = MaterialTheme.typography.titleSmall)
                step.description?.let { Text(it) }
                val details = listOfNotNull(step.priority, step.dueDate,
                    step.minutes?.let { stringResource(R.string.chat_plan_minutes, it) })
                if (details.isNotEmpty()) Text(details.joinToString(" · "))
                if (step.dependencies.isNotEmpty()) {
                    Text(stringResource(R.string.chat_plan_dependencies,
                        step.dependencies.joinToString(", ") { (it + 1).toString() }))
                }
            }
            if (plan.diff.rootFields.isNotEmpty()) {
                Text(stringResource(R.string.chat_plan_root_changes), style = MaterialTheme.typography.titleSmall)
                for (field in plan.diff.rootFields) {
                    val label = stringResource(when (field) {
                        "due_date" -> R.string.chat_plan_due
                        "assignee", "enabled_skills" -> R.string.chat_plan_assignee
                        "source", "source_id" -> R.string.chat_plan_project
                        else -> R.string.chat_plan_other
                    })
                    val value = when (field) {
                        "due_date" -> plan.rootDueDate ?: plan.subtasks.mapNotNull { it.dueDate }.maxOrNull()
                        "assignee", "enabled_skills" -> plan.skills?.takeIf { it.isNotEmpty() }?.joinToString(", ") ?: plan.assignee
                        "source", "source_id" -> plan.projectTitle
                        else -> field
                    }
                    Text("$label: ${value ?: "—"}")
                }
            }
            }
            (plan.validation.errors + plan.validation.warnings).forEach { Text(it.message) }
            if (plan.status == "draft" && expanded) {
                Button(onClick = { onAction("apply") }, enabled = plan.canApply && !pending) {
                    Text(pluralStringResource(R.plurals.chat_plan_apply, plan.subtasks.size, plan.subtasks.size))
                }
            }
            Row {
                if (plan.status == "draft" || plan.status == "stale") {
                    TextButton(onClick = { onAction("dismiss") }, enabled = !pending) {
                        Text(stringResource(R.string.chat_plan_dismiss))
                    }
                }
                if (canUndo && plan.status == "applied") {
                    TextButton(onClick = { onAction("undo") }, enabled = !pending) {
                        Text(stringResource(R.string.chat_plan_undo))
                    }
                }
            }
        }
    }
}
