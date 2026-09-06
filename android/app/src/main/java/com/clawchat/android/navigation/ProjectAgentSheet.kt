package com.clawchat.android.navigation

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.clawchat.android.feature.chat.ChatScreen
import com.clawchat.android.feature.chat.ChatViewModel

/** The project stays composed underneath; the existing chat owns its single bottom composer. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProjectAgentSheet(
    conversationId: String,
    title: String?,
    focusInput: Boolean,
    onDismiss: () -> Unit,
) {
    // Keep each thread's streaming state separate for the lifetime of this project route.
    val chat: ChatViewModel = hiltViewModel(key = "project-thread:$conversationId")
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        modifier = Modifier.fillMaxHeight(),
        // ChatScreen/ClawComposer already handle system bars and the keyboard.
        contentWindowInsets = { WindowInsets(0, 0, 0, 0) },
    ) {
        ChatScreen(
            initialConversationId = conversationId,
            contextTitle = title,
            focusComposerOnOpen = focusInput,
            onReturnToSource = onDismiss,
            viewModel = chat,
        )
    }
}
