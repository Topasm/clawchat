package com.clawchat.android.widget.quickadd

import android.content.Context
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.glance.appwidget.GlanceAppWidgetManager
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.di.WidgetEntryPoint
import com.clawchat.android.widget.tracking.TodoTrackingWidget
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.launch

class QuickAddActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val entryPoint = EntryPointAccessors.fromApplication(
            applicationContext,
            WidgetEntryPoint::class.java,
        )
        val todoRepository = entryPoint.todoRepository()

        setContent {
            MaterialTheme {
                var text by remember { mutableStateOf("") }
                var isSubmitting by remember { mutableStateOf(false) }
                val scope = rememberCoroutineScope()
                val focusRequester = remember { FocusRequester() }

                Dialog(
                    onDismissRequest = { finish() },
                    properties = DialogProperties(usePlatformDefaultWidth = false),
                ) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp),
                        shape = RoundedCornerShape(24.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surface,
                        ),
                        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
                    ) {
                        Column(modifier = Modifier.padding(20.dp)) {
                            Text(
                                text = "Add to inbox",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )

                            Spacer(Modifier.height(12.dp))

                            OutlinedTextField(
                                value = text,
                                onValueChange = { text = it },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .focusRequester(focusRequester),
                                placeholder = { Text("What needs to be done?") },
                                singleLine = true,
                                enabled = !isSubmitting,
                                shape = RoundedCornerShape(12.dp),
                            )

                            Spacer(Modifier.height(16.dp))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                TextButton(
                                    onClick = { finish() },
                                    enabled = !isSubmitting,
                                ) {
                                    Text("Cancel")
                                }
                                Spacer(Modifier.width(8.dp))
                                FilledTonalButton(
                                    onClick = {
                                        if (text.isBlank()) return@FilledTonalButton
                                        isSubmitting = true
                                        scope.launch {
                                            val result = todoRepository.createTodo(
                                                TodoCreate(title = text.trim())
                                            )
                                            when (result) {
                                                is ApiResult.Success -> {
                                                    Toast.makeText(
                                                        this@QuickAddActivity,
                                                        "Added to inbox",
                                                        Toast.LENGTH_SHORT,
                                                    ).show()
                                                    updateAllWidgets(this@QuickAddActivity)
                                                    finish()
                                                }
                                                is ApiResult.Error -> {
                                                    Toast.makeText(
                                                        this@QuickAddActivity,
                                                        "Failed: ${result.message}",
                                                        Toast.LENGTH_SHORT,
                                                    ).show()
                                                    isSubmitting = false
                                                }
                                                is ApiResult.Loading -> {}
                                            }
                                        }
                                    },
                                    enabled = text.isNotBlank() && !isSubmitting,
                                ) {
                                    Text("Add")
                                }
                            }
                        }
                    }
                }

                LaunchedEffect(Unit) {
                    focusRequester.requestFocus()
                }
            }
        }
    }
}

private suspend fun updateAllWidgets(context: Context) {
    val manager = GlanceAppWidgetManager(context)
    for (id in manager.getGlanceIds(InboxQuickAddWidget::class.java)) {
        InboxQuickAddWidget().update(context, id)
    }
    for (id in manager.getGlanceIds(TodoTrackingWidget::class.java)) {
        TodoTrackingWidget().update(context, id)
    }
}
