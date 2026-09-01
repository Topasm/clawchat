package com.clawchat.android.feature.chat

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import android.text.format.DateFormat
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.icons.ClawIcons
import java.time.Duration
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

@Composable
private fun formatRelativeTime(isoTimestamp: String): String {
    if (isoTimestamp.isBlank()) return ""
    val locale = LocalLocale.current.platformLocale
    val shortDateFormatter = remember(locale) {
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "MMMd"), locale)
    }
    val parsed = parseDisplayDateTime(isoTimestamp) ?: return isoTimestamp.take(10)
    val duration = Duration.between(parsed, ZonedDateTime.now())
    val minutes = duration.toMinutes().toDisplayCount()
    val hours = duration.toHours().toDisplayCount()
    val days = duration.toDays().toDisplayCount()
    return when {
        minutes < 1 -> stringResource(R.string.chat_just_now)
        minutes < 60 -> pluralStringResource(R.plurals.chat_minutes_ago, minutes, minutes)
        hours < 24 -> pluralStringResource(R.plurals.chat_hours_ago, hours, hours)
        days < 7 -> pluralStringResource(R.plurals.chat_days_ago, days, days)
        else -> parsed.format(shortDateFormatter)
    }
}

private fun Long.toDisplayCount(): Int = coerceIn(0, Int.MAX_VALUE.toLong()).toInt()

@Composable
private fun formatMessageTime(isoTimestamp: String): String {
    if (isoTimestamp.isBlank()) return ""
    val context = LocalContext.current
    val locale = LocalLocale.current.platformLocale
    val is24Hour = DateFormat.is24HourFormat(context)
    val formatter = remember(locale, is24Hour) {
        DateTimeFormatter.ofPattern(
            DateFormat.getBestDateTimePattern(locale, if (is24Hour) "Hm" else "hm"),
            locale,
        )
    }
    return parseDisplayDateTime(isoTimestamp)?.format(formatter).orEmpty()
}

/**
 * Moves instant-bearing timestamps to the device timezone, while treating a
 * timestamp without an offset as device-local wall time.
 */
internal fun parseDisplayDateTime(
    isoTimestamp: String,
    deviceZone: ZoneId = ZoneId.systemDefault(),
): ZonedDateTime? = runCatching {
    ZonedDateTime.parse(isoTimestamp, DateTimeFormatter.ISO_DATE_TIME)
        .withZoneSameInstant(deviceZone)
}
    .recoverCatching {
        LocalDateTime.parse(isoTimestamp, DateTimeFormatter.ISO_DATE_TIME)
            .atZone(deviceZone)
    }
    .getOrNull()

@Composable
fun ChatScreen(
    onOpenSearch: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val newConversationTitle = stringResource(R.string.chat_new_conversation_default_title)

    BackHandler(enabled = state.selectedConversationId != null) {
        viewModel.clearSelection()
    }

    if (state.selectedConversationId != null) {
        ChatDetailView(
            messages = state.messages,
            streamingText = state.streamingText,
            isStreaming = state.isStreaming,
            isLoadingMessages = state.isLoadingMessages,
            onSend = viewModel::sendMessage,
            onStop = viewModel::stopStreaming,
            onBack = viewModel::clearSelection,
        )
    } else {
        ConversationListView(
            conversations = state.conversations,
            isLoading = state.isLoadingConversations,
            onOpenSearch = onOpenSearch,
            onOpenSettings = onOpenSettings,
            onSelect = viewModel::selectConversation,
            onCreate = { viewModel.createConversation(newConversationTitle) },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationListView(
    conversations: List<Conversation>,
    isLoading: Boolean,
    onOpenSearch: () -> Unit,
    onOpenSettings: () -> Unit,
    onSelect: (String) -> Unit,
    onCreate: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.chat_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                actions = {
                    IconButton(onClick = onOpenSearch) {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = stringResource(R.string.chat_search),
                        )
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = stringResource(R.string.chat_settings),
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
        floatingActionButton = {
            SmallFloatingActionButton(
                modifier = Modifier.size(48.dp),
                onClick = onCreate,
                shape = MaterialTheme.shapes.medium,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = stringResource(R.string.chat_new_chat),
                )
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (isLoading && conversations.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(R.string.chat_loading_conversations),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else if (conversations.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(16.dp),
                contentAlignment = Alignment.Center,
            ) {
                ClawEmptyState(
                    title = stringResource(R.string.chat_no_conversations),
                    description = stringResource(R.string.chat_no_conversations_description),
                    icon = {
                        Icon(
                            ClawIcons.Chat,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    },
                    actionLabel = stringResource(R.string.chat_start_chatting),
                    onActionClick = onCreate,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 0.dp, bottom = 72.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                items(conversations, key = { it.id }) { convo ->
                    ConversationCard(
                        conversation = convo,
                        onClick = { onSelect(convo.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ConversationCard(
    conversation: Conversation,
    onClick: () -> Unit,
) {
    val locale = LocalLocale.current.platformLocale
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .defaultMinSize(minHeight = 60.dp)
                .padding(horizontal = 2.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(6.dp),
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                modifier = Modifier.size(36.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = conversation.title.firstOrNull()?.uppercase(locale) ?: "?",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(1.dp),
            ) {
                Text(
                    text = conversation.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = formatRelativeTime(conversation.updatedAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatDetailView(
    messages: List<Message>,
    streamingText: String,
    isStreaming: Boolean,
    isLoadingMessages: Boolean,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onBack: () -> Unit,
) {
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val locale = LocalLocale.current.platformLocale
    val speechPrompt = stringResource(R.string.chat_speak_now)

    val speechLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val spokenText = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
            if (spokenText != null) {
                inputText = if (inputText.isBlank()) spokenText else "$inputText $spokenText"
            }
        }
    }

    LaunchedEffect(messages.size, streamingText) {
        val extraItem = if (streamingText.isNotBlank()) 1 else 0
        val total = messages.size + extraItem
        if (total > 0) {
            listState.animateScrollToItem(total - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                        Text(
                            text = stringResource(R.string.chat_conversation),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = stringResource(
                                if (isStreaming) {
                                    R.string.chat_assistant_responding
                                } else {
                                    R.string.chat_conversation_subtitle
                                },
                            ),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.chat_back),
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
        bottomBar = {
            ChatComposer(
                inputText = inputText,
                onInputChange = { inputText = it },
                isStreaming = isStreaming,
                onStop = onStop,
                onSend = {
                    if (inputText.isNotBlank()) {
                        onSend(inputText)
                        inputText = ""
                    }
                },
                onVoiceInput = {
                    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale.toLanguageTag())
                        putExtra(RecognizerIntent.EXTRA_PROMPT, speechPrompt)
                    }
                    speechLauncher.launch(intent)
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (isLoadingMessages && messages.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(R.string.chat_loading_messages),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                state = listState,
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (messages.isEmpty() && streamingText.isBlank()) {
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = stringResource(R.string.chat_start_conversation),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = stringResource(R.string.chat_start_conversation_description),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                itemsIndexed(messages, key = { _, message -> message.id }) { _, message ->
                    MessageBubble(message = message)
                }

                if (streamingText.isNotBlank()) {
                    item {
                        MessageBubble(
                            message = Message(
                                id = "streaming",
                                content = streamingText,
                                role = "assistant",
                            ),
                            streaming = true,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatComposer(
    inputText: String,
    onInputChange: (String) -> Unit,
    isStreaming: Boolean,
    onStop: () -> Unit,
    onSend: () -> Unit,
    onVoiceInput: () -> Unit,
) {
    Surface(
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        color = MaterialTheme.colorScheme.background,
    ) {
        Column {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    TextField(
                        value = inputText,
                        onValueChange = onInputChange,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = {
                            Text(
                                stringResource(R.string.chat_input_placeholder),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                            )
                        },
                        maxLines = 5,
                        textStyle = MaterialTheme.typography.bodyMedium,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            disabledIndicatorColor = Color.Transparent,
                        ),
                    )
                }

                Surface(
                    modifier = Modifier.size(48.dp),
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .clickable(onClick = onVoiceInput),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            ClawIcons.PhoneAndroid,
                            contentDescription = stringResource(R.string.chat_voice_input),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Surface(
                    modifier = Modifier.size(48.dp),
                    shape = RoundedCornerShape(8.dp),
                    color = if (isStreaming) {
                        MaterialTheme.colorScheme.error.copy(alpha = 0.12f)
                    } else if (inputText.isNotBlank()) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.surface
                    },
                    border = if (isStreaming || inputText.isNotBlank()) null else {
                        androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                    },
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .alpha(if (isStreaming || inputText.isNotBlank()) 1f else 0.6f)
                            .clickable(enabled = isStreaming || inputText.isNotBlank()) {
                                if (isStreaming) onStop() else onSend()
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isStreaming) {
                            Icon(
                                ClawIcons.Stop,
                                contentDescription = stringResource(R.string.chat_stop),
                                tint = MaterialTheme.colorScheme.error,
                            )
                        } else {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                contentDescription = stringResource(R.string.chat_send),
                                tint = if (inputText.isNotBlank()) {
                                    MaterialTheme.colorScheme.onPrimary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: Message,
    streaming: Boolean = false,
) {
    val isUser = message.role == "user"
    val alignment = if (isUser) Alignment.End else Alignment.Start
    val bubbleColor = if (isUser) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
    } else {
        Color.Transparent
    }
    val timeLabel = if (streaming) {
        stringResource(R.string.chat_streaming)
    } else {
        formatMessageTime(message.createdAt)
    }
    val contentWidth = if (isUser) 0.88f else 1f

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = alignment,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(contentWidth),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = stringResource(if (isUser) R.string.chat_you else R.string.chat_assistant),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
                color = if (isUser) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            if (timeLabel.isNotBlank()) {
                Text(
                    text = timeLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (isUser) {
            Surface(
                modifier = Modifier.fillMaxWidth(contentWidth),
                shape = RoundedCornerShape(8.dp),
                color = bubbleColor,
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                ),
            ) {
                Text(
                    text = message.content,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        } else {
            Text(
                text = message.content,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 2.dp, vertical = 4.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}
