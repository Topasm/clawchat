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
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.R
import com.clawchat.android.widget.common.WidgetUpdater
import com.clawchat.android.widget.di.WidgetEntryPoint
import dagger.hilt.android.EntryPointAccessors
import java.util.UUID
import kotlinx.coroutines.launch

class QuickAddActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val target = QuickAddTarget.fromWireValue(intent.getStringExtra(EXTRA_TARGET))
        val entryPoint = EntryPointAccessors.fromApplication(
            applicationContext,
            WidgetEntryPoint::class.java,
        )
        val todoRepository = entryPoint.todoRepository()

        setContent {
            MaterialTheme {
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

                val submitTask: () -> Unit = {
                    val request = QuickAddRequestFactory.create(
                        title = text,
                        target = target,
                        idempotencyKey = idempotencyKey,
                    )
                    if (!isSubmitting && request != null) {
                        isSubmitting = true
                        scope.launch {
                            when (val result = todoRepository.createTodo(request)) {
                                is ApiResult.Success -> {
                                    keyboardController?.hide()
                                    Toast.makeText(
                                        this@QuickAddActivity,
                                        getString(
                                            if (target == QuickAddTarget.TODAY) {
                                                R.string.quick_add_today_success
                                            } else {
                                                R.string.quick_add_inbox_success
                                            }
                                        ),
                                        Toast.LENGTH_SHORT,
                                    ).show()
                                    WidgetUpdater.updateAll(this@QuickAddActivity)
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
                            .padding(horizontal = 24.dp),
                        shape = RoundedCornerShape(20.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surface,
                        ),
                        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
                    ) {
                        Column(modifier = Modifier.padding(20.dp)) {
                            Text(
                                text = stringResource(
                                    if (target == QuickAddTarget.TODAY) {
                                        R.string.quick_add_today_title
                                    } else {
                                        R.string.quick_add_inbox_title
                                    }
                                ),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )

                            Spacer(Modifier.height(12.dp))

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
                                shape = RoundedCornerShape(12.dp),
                                keyboardOptions = KeyboardOptions(
                                    capitalization = KeyboardCapitalization.Sentences,
                                    imeAction = ImeAction.Done,
                                ),
                                keyboardActions = KeyboardActions(onDone = { submitTask() }),
                            )

                            Spacer(Modifier.height(12.dp))

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
                                    enabled = text.isNotBlank() && !isSubmitting,
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
        private const val EXTRA_TARGET = "com.clawchat.android.widget.quickadd.TARGET"

        fun createIntent(context: Context, target: QuickAddTarget): Intent =
            Intent(context, QuickAddActivity::class.java)
                .putExtra(EXTRA_TARGET, target.wireValue)
                // Distinct data prevents launchers from reusing an Inbox pending intent for Today.
                .setData(
                    Uri.Builder()
                        .scheme("clawchat")
                        .authority("quick-add")
                        .appendPath(target.wireValue)
                        .build()
                )
    }
}
