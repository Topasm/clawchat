package com.clawchat.android.widget.configuration

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.clawchat.android.widget.R
import com.clawchat.android.widget.common.WidgetAppearance
import com.clawchat.android.widget.common.WidgetBackgroundOpacityKey
import com.clawchat.android.widget.quickadd.InboxQuickAddWidget
import com.clawchat.android.widget.quickadd.InboxQuickAddWidgetReceiver
import com.clawchat.android.widget.tracking.TodoTrackingWidget
import com.clawchat.android.widget.tracking.TodoTrackingWidgetReceiver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

class WidgetConfigurationActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // The launcher must only keep the widget after the user explicitly applies the setting.
        setResult(Activity.RESULT_CANCELED)

        val manager = GlanceAppWidgetManager(this)
        val glanceId = manager.getGlanceIdBy(intent) ?: run {
            finish()
            return
        }
        val appWidgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        )
        val providerClassName = AppWidgetManager.getInstance(this)
            .getAppWidgetInfo(appWidgetId)
            ?.provider
            ?.className
        val widgetKind = ConfigurableWidgetKind.fromProvider(providerClassName) ?: run {
            finish()
            return
        }

        setContent {
            ClawChatTheme(themeModeKey = "system") {
                var savedAppearance by remember { mutableStateOf<WidgetAppearance?>(null) }

                LaunchedEffect(glanceId) {
                    val preferences = getAppWidgetState(
                        this@WidgetConfigurationActivity,
                        PreferencesGlanceStateDefinition,
                        glanceId,
                    )
                    savedAppearance = WidgetAppearance.from(preferences)
                }

                val appearance = savedAppearance
                if (appearance == null) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                } else {
                    WidgetConfigurationScreen(
                        widgetKind = widgetKind,
                        initialTransparency = appearance.backgroundTransparencyPercent,
                        onCancel = ::finish,
                        onApply = { transparency ->
                            saveConfiguration(
                                glanceId = glanceId,
                                appWidgetId = appWidgetId,
                                widgetKind = widgetKind,
                                appearance = WidgetAppearance.fromTransparency(transparency),
                            )
                        },
                    )
                }
            }
        }
    }

    @Composable
    private fun WidgetConfigurationScreen(
        widgetKind: ConfigurableWidgetKind,
        initialTransparency: Int,
        onCancel: () -> Unit,
        onApply: suspend (Int) -> Unit,
    ) {
        var transparency by rememberSaveable { mutableIntStateOf(initialTransparency) }
        var isSaving by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        val appearance = WidgetAppearance.fromTransparency(transparency)
        val context = LocalContext.current
        val saveFailedMessage = stringResource(R.string.widget_config_save_failed)

        Scaffold { contentPadding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(contentPadding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 24.dp),
            ) {
                Text(
                    text = stringResource(R.string.widget_config_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.widget_config_description),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Spacer(Modifier.height(28.dp))
                Text(
                    text = stringResource(R.string.widget_config_preview),
                    style = MaterialTheme.typography.labelLarge,
                )
                Spacer(Modifier.height(8.dp))
                WidgetAppearancePreview(
                    widgetKind = widgetKind,
                    backgroundOpacity = appearance.backgroundOpacity,
                )

                Spacer(Modifier.height(28.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.widget_config_transparency),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = stringResource(R.string.widget_config_percent, transparency),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Slider(
                    value = transparency.toFloat(),
                    onValueChange = { transparency = (it / 5).roundToInt() * 5 },
                    valueRange = 0f..100f,
                    steps = 19,
                    enabled = !isSaving,
                )
                Text(
                    text = stringResource(R.string.widget_config_transparency_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Spacer(Modifier.height(32.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OutlinedButton(
                        onClick = onCancel,
                        enabled = !isSaving,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(stringResource(R.string.widget_config_cancel))
                    }
                    Button(
                        onClick = {
                            if (!isSaving) {
                                isSaving = true
                                scope.launch {
                                    try {
                                        onApply(transparency)
                                    } catch (cancelled: CancellationException) {
                                        throw cancelled
                                    } catch (_: Exception) {
                                        isSaving = false
                                        Toast.makeText(
                                            context,
                                            saveFailedMessage,
                                            Toast.LENGTH_SHORT,
                                        ).show()
                                    }
                                }
                            }
                        },
                        enabled = !isSaving,
                        modifier = Modifier.weight(1f),
                    ) {
                        if (isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(stringResource(R.string.widget_config_apply))
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun WidgetAppearancePreview(
        widgetKind: ConfigurableWidgetKind,
        backgroundOpacity: Float,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(16.dp),
                )
                .padding(18.dp),
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = backgroundOpacity),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = stringResource(widgetKind.titleResource),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = stringResource(widgetKind.previewResource),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    private suspend fun saveConfiguration(
        glanceId: GlanceId,
        appWidgetId: Int,
        widgetKind: ConfigurableWidgetKind,
        appearance: WidgetAppearance,
    ) {
        updateAppWidgetState(this@WidgetConfigurationActivity, glanceId) { preferences ->
            preferences[WidgetBackgroundOpacityKey] = appearance.backgroundOpacityPercent
        }

        try {
            widgetKind.widget.update(this@WidgetConfigurationActivity, glanceId)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // The setting is durable. A later widget refresh can recover rendering.
        }

        setResult(
            Activity.RESULT_OK,
            Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId),
        )
        finish()
    }
}

private enum class ConfigurableWidgetKind(
    val widget: GlanceAppWidget,
    val titleResource: Int,
    val previewResource: Int,
) {
    Today(
        widget = TodoTrackingWidget(),
        titleResource = R.string.widget_today_title,
        previewResource = R.string.widget_config_today_preview,
    ),
    Inbox(
        widget = InboxQuickAddWidget(),
        titleResource = R.string.widget_inbox,
        previewResource = R.string.widget_config_inbox_preview,
    );

    companion object {
        fun fromProvider(className: String?): ConfigurableWidgetKind? = when (className) {
            TodoTrackingWidgetReceiver::class.java.name -> Today
            InboxQuickAddWidgetReceiver::class.java.name -> Inbox
            else -> null
        }
    }
}
