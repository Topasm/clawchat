package com.clawchat.android.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import com.clawchat.android.core.ui.icons.ClawIcons
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import java.time.Duration
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Formats an ISO-8601 timestamp string into a short relative or absolute label.
 */
private fun formatRelativeTime(isoTimestamp: String): String {
    if (isoTimestamp.isBlank()) return ""
    return try {
        val parsed = ZonedDateTime.parse(isoTimestamp, DateTimeFormatter.ISO_DATE_TIME)
        val now = ZonedDateTime.now()
        val duration = Duration.between(parsed, now)
        val minutes = duration.toMinutes()
        val hours = duration.toHours()
        val days = duration.toDays()
        when {
            minutes < 1 -> "just now"
            minutes < 60 -> "${minutes}m ago"
            hours < 24 -> "${hours}h ago"
            days < 7 -> "${days}d ago"
            else -> parsed.format(DateTimeFormatter.ofPattern("MMM d"))
        }
    } catch (_: DateTimeParseException) {
        isoTimestamp.take(10) // fallback: show date portion
    }
}

/**
 * Formats message timestamp into a short time-only label for chat bubbles.
 */
private fun formatMessageTime(isoTimestamp: String): String {
    if (isoTimestamp.isBlank()) return ""
    return try {
        val parsed = ZonedDateTime.parse(isoTimestamp, DateTimeFormatter.ISO_DATE_TIME)
        parsed.format(DateTimeFormatter.ofPattern("h:mm a"))
    } catch (_: DateTimeParseException) {
        ""
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    if (state.selectedConversationId != null) {
        ChatDetailView(
            messages = state.messages,
            streamingText = state.streamingText,
            isStreaming = state.isStreaming,
            onSend = viewModel::sendMessage,
            onStop = viewModel::stopStreaming,
            onBack = viewModel::clearSelection,
        )
    } else {
        ConversationListView(
            conversations = state.conversations,
            isLoading = state.isLoadingConversations,
            onSelect = viewModel::selectConversation,
            onCreate = viewModel::createConversation,
            onRefresh = viewModel::loadConversations,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationListView(
    conversations: List<Conversation>,
    isLoading: Boolean,
    onSelect: (String) -> Unit,
    onCreate: () -> Unit,
    onRefresh: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Chat",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onCreate,
                shape = RoundedCornerShape(16.dp),
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(Icons.Default.Add, contentDescription = "New conversation")
            }
        },
        containerColor = MaterialTheme.colorScheme.surface,
    ) { padding ->
        if (isLoading && conversations.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(strokeWidth = 3.dp)
            }
        } else if (conversations.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        ClawIcons.Chat,
                        contentDescription = null,
                        modifier = Modifier.size(40.dp),
                        tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f),
                    )
                    Spacer(Modifier.height(16.dp))
                    Text(
                        "No conversations yet",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Start a new conversation",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    )
                    Spacer(Modifier.height(20.dp))
                    FilledTonalButton(
                        onClick = onCreate,
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text("Start chatting")
                    }
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(conversations, key = { it.id }) { convo ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        onClick = { onSelect(convo.id) },
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // First-letter avatar
                            Surface(
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.primaryContainer,
                                modifier = Modifier.size(40.dp),
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        text = convo.title.firstOrNull()?.uppercase() ?: "?",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.primary,
                                        textAlign = TextAlign.Center,
                                    )
                                }
                            }
                            Spacer(Modifier.width(14.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    convo.title,
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            // Relative timestamp on the right
                            val relativeTime = remember(convo.updatedAt) {
                                formatRelativeTime(convo.updatedAt)
                            }
                            if (relativeTime.isNotBlank()) {
                                Text(
                                    relativeTime,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                )
                            }
                            // Chevron arrow
                            Icon(
                                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                contentDescription = null,
                                modifier = Modifier.size(20.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatDetailView(
    messages: List<Message>,
    streamingText: String,
    isStreaming: Boolean,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onBack: () -> Unit,
) {
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Auto-scroll to bottom on new messages
    LaunchedEffect(messages.size, streamingText) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1 + if (streamingText.isNotBlank()) 1 else 0)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Chat",
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.surface,
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            // Messages
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                itemsIndexed(messages, key = { _, msg -> msg.id }, contentType = { _, _ -> "message" }) { index, msg ->
                    val previousRole = if (index > 0) messages[index - 1].role else null
                    val senderChanged = previousRole != null && previousRole != msg.role
                    if (senderChanged) {
                        Spacer(Modifier.height(4.dp))
                    }
                    MessageBubble(message = msg)
                }
                // Streaming message
                if (streamingText.isNotBlank()) {
                    item {
                        val previousRole = messages.lastOrNull()?.role
                        val senderChanged = previousRole != null && previousRole != "assistant"
                        if (senderChanged) {
                            Spacer(Modifier.height(4.dp))
                        }
                        MessageBubble(
                            message = Message(
                                id = "streaming",
                                content = streamingText,
                                role = "assistant",
                            ),
                        )
                    }
                }
            }

            // Input bar — compact, modern
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                TextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    placeholder = {
                        Text(
                            "Message\u2026",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        )
                    },
                    modifier = Modifier.weight(1f),
                    maxLines = 4,
                    textStyle = MaterialTheme.typography.bodyMedium,
                    shape = RoundedCornerShape(22.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        disabledIndicatorColor = Color.Transparent,
                    ),
                )
                Spacer(Modifier.width(8.dp))
                if (isStreaming) {
                    IconButton(
                        onClick = onStop,
                        modifier = Modifier.size(36.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .background(
                                    MaterialTheme.colorScheme.errorContainer,
                                    CircleShape,
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                ClawIcons.Stop,
                                contentDescription = "Stop",
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                } else {
                    IconButton(
                        onClick = {
                            if (inputText.isNotBlank()) {
                                onSend(inputText)
                                inputText = ""
                            }
                        },
                        enabled = inputText.isNotBlank(),
                        modifier = Modifier.size(36.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .background(
                                    color = if (inputText.isNotBlank()) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.surfaceContainerHigh,
                                    shape = CircleShape,
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                contentDescription = "Send",
                                modifier = Modifier.size(18.dp),
                                tint = if (inputText.isNotBlank()) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: Message) {
    val isUser = message.role == "user"
    val alignment = if (isUser) Alignment.End else Alignment.Start

    // Asymmetric corners — Fluent chat style
    val bubbleShape = if (isUser)
        RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp)
    else
        RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)

    val containerColor = if (isUser)
        MaterialTheme.colorScheme.primary
    else
        MaterialTheme.colorScheme.surfaceContainerLow

    val contentColor = if (isUser)
        MaterialTheme.colorScheme.onPrimary
    else
        MaterialTheme.colorScheme.onSurface

    val timeText = remember(message.createdAt) { formatMessageTime(message.createdAt) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = alignment,
    ) {
        Surface(
            shape = bubbleShape,
            color = containerColor,
            modifier = Modifier.fillMaxWidth(0.8f),
        ) {
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = contentColor,
                )
                if (timeText.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = timeText,
                        style = MaterialTheme.typography.labelSmall,
                        color = contentColor.copy(alpha = 0.55f),
                        modifier = Modifier.align(Alignment.End),
                    )
                }
            }
        }
    }
}
