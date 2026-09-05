package com.clawchat.android.core.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role

@Composable
fun ClawSelectionRow(label: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.small,
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().heightIn(min = ClawMobileLayout.TouchTarget)
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = ClawMobileLayout.ContentInset, vertical = ClawMobileLayout.ItemGap),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ClawMobileLayout.ItemGap)) {
            RadioButton(selected = selected, onClick = null, enabled = enabled)
            Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge,
                color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
