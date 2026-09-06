package com.clawchat.android.core.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp

/** Shared mobile dimensions. Use minimum heights so system font scaling can grow rows. */
object ClawMobileLayout {
    val PageInset = 16.dp
    val ContentInset = 12.dp
    val ItemGap = 8.dp
    val TouchTarget = 48.dp
    val IconSize = 24.dp
    const val ComposerLines = 4
    const val MaxOutlineIndent = 3
}

@Composable
fun ClawComposer(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    enabled: Boolean,
    actionEnabled: Boolean,
    actionIcon: ImageVector,
    actionLabel: String,
    onAction: () -> Unit,
    focusOnOpen: Boolean = false,
    supportingContent: @Composable ColumnScope.() -> Unit = {},
) {
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var requestedFocus by remember { mutableStateOf(false) }
    LaunchedEffect(focusOnOpen, enabled) {
        if (focusOnOpen && enabled && !requestedFocus) {
            withFrameNanos { }
            focusRequester.requestFocus()
            keyboard?.show()
            requestedFocus = true
        }
    }
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(Modifier.navigationBarsPadding().imePadding()) {
            HorizontalDivider()
            Column(Modifier.fillMaxWidth().padding(horizontal = ClawMobileLayout.PageInset, vertical = ClawMobileLayout.ItemGap)) {
                OutlinedTextField(
                    value = value, onValueChange = onValueChange, enabled = enabled,
                    modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
                    placeholder = { Text(placeholder) },
                    textStyle = MaterialTheme.typography.bodyLarge,
                    shape = MaterialTheme.shapes.large,
                    maxLines = ClawMobileLayout.ComposerLines,
                    trailingIcon = {
                        IconButton(onClick = onAction, enabled = actionEnabled, modifier = Modifier.size(ClawMobileLayout.TouchTarget)) {
                            Icon(actionIcon, contentDescription = actionLabel, modifier = Modifier.size(ClawMobileLayout.IconSize))
                        }
                    },
                )
                supportingContent()
            }
        }
    }
}
