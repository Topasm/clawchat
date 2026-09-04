package com.clawchat.android.widget.quickadd

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.clawchat.android.widget.R
import com.clawchat.android.widget.di.WidgetEntryPoint
import dagger.hilt.android.EntryPointAccessors
import java.util.UUID
import kotlinx.coroutines.launch

class QuickAddActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val entryPoint = EntryPointAccessors.fromApplication(
            applicationContext,
            WidgetEntryPoint::class.java,
        )
        val todoRepository = entryPoint.todoRepository()
        val sessionStore = entryPoint.sessionStore()

        setContent {
            val themeMode by sessionStore.themeMode.collectAsStateWithLifecycle(initialValue = "light")
            val accentColor by sessionStore.accentColor.collectAsStateWithLifecycle(initialValue = "system")
            val runtimeState by sessionStore.runtimeState.collectAsStateWithLifecycle(
                initialValue = null,
            )
            ClawChatTheme(
                themeModeKey = themeMode,
                accentColorKey = accentColor,
            ) {
                var text by rememberSaveable { mutableStateOf("") }
                var idempotencyKey by rememberSaveable {
                    mutableStateOf(UUID.randomUUID().toString())
                }
                // A request coroutine is cancelled on recreation, so this must not be restored
                // as true. The saveable operation key makes retrying safe instead.
                var isSubmitting by remember { mutableStateOf(false) }
                val scope = rememberCoroutineScope()
                val focusRequester = remember { FocusRequester() }
                val keyboardController = LocalSoftwareKeyboardController.current
                val request = remember(text, idempotencyKey) {
                    QuickAddRequestFactory.create(
                        title = text,
                        idempotencyKey = idempotencyKey,
                    )
                }
                val hasInvalidDraft = text.isNotBlank() && request == null

                val submitTask: () -> Unit = {
                    val expectedWorkspaceKey = runtimeState?.workspaceKey
                    if (!isSubmitting && request != null && expectedWorkspaceKey != null) {
                        isSubmitting = true
                        scope.launch {
                            when (
                                val result = todoRepository.createTodo(
                                    request,
                                    expectedWorkspaceKey,
                                )
                            ) {
                                is ApiResult.Success -> {
                                    keyboardController?.hide()
                                    Toast.makeText(
                                        this@QuickAddActivity,
                                        getString(R.string.quick_add_inbox_success),
                                        Toast.LENGTH_SHORT,
                                    ).show()
                                    finish()
                                }
                                is ApiResult.Error -> {
                                    Toast.makeText(
                                        this@QuickAddActivity,
                                        getString(R.string.quick_add_failed),
                                        Toast.LENGTH_SHORT,
                                    ).show()
                                    // Keep the key for a safe retry of the same draft.
                                    isSubmitting = false
                                }
                                is ApiResult.Loading -> isSubmitting = false
                            }
                        }
                    }
                }

                Dialog(
                    onDismissRequest = { if (!isSubmitting) finish() },
                    properties = DialogProperties(usePlatformDefaultWidth = false),
                ) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp),
                        shape = RoundedCornerShape(8.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surface,
                        ),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = stringResource(R.string.quick_add_inbox_title),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )

                            Spacer(Modifier.height(8.dp))

                            OutlinedTextField(
                                value = text,
                                onValueChange = { updated ->
                                    if (!isSubmitting) {
                                        if (updated != text) {
                                            // A changed draft is a new logical operation.
                                            idempotencyKey = UUID.randomUUID().toString()
                                        }
                                        text = updated
                                    }
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .focusRequester(focusRequester),
                                placeholder = { Text(stringResource(R.string.quick_add_hint)) },
                                singleLine = true,
                                enabled = !isSubmitting,
                                shape = RoundedCornerShape(6.dp),
                                keyboardOptions = KeyboardOptions(
                                    capitalization = KeyboardCapitalization.Sentences,
                                    imeAction = ImeAction.Done,
                                ),
                                keyboardActions = KeyboardActions(onDone = { submitTask() }),
                                isError = hasInvalidDraft,
                                supportingText = if (hasInvalidDraft) {
                                    { Text(stringResource(R.string.quick_add_title_required)) }
                                } else {
                                    null
                                },
                            )

                            Spacer(Modifier.height(8.dp))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                TextButton(
                                    onClick = { finish() },
                                    enabled = !isSubmitting,
                                ) {
                                    Text(stringResource(R.string.quick_add_cancel))
                                }
                                Spacer(Modifier.width(8.dp))
                                FilledTonalButton(
                                    onClick = submitTask,
                                    enabled = request != null &&
                                        !isSubmitting &&
                                        runtimeState?.workspaceKey != null,
                                    shape = RoundedCornerShape(6.dp),
                                ) {
                                    Text(stringResource(R.string.quick_add_add))
                                }
                            }
                        }
                    }
                }

                LaunchedEffect(focusRequester) {
                    focusRequester.requestFocus()
                    keyboardController?.show()
                }
            }
        }
    }

    companion object {
        fun createIntent(context: Context): Intent =
            Intent(context, QuickAddActivity::class.java)
                .setData(
                    Uri.Builder()
                        .scheme("clawchat")
                        .authority("quick-add")
                        .appendPath("inbox")
                        .build()
                )
    }
}
