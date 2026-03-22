package com.clawchat.android.core.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// --- Health ---

@Serializable
data class HealthResponse(
    val status: String, // "ok" | "degraded"
    val version: String,
    @SerialName("ai_provider") val aiProvider: String,
    @SerialName("ai_model") val aiModel: String,
    @SerialName("ai_connected") val aiConnected: Boolean,
    @SerialName("claude_code_status") val claudeCodeStatus: String = "unknown",
    @SerialName("claude_code_version") val claudeCodeVersion: String? = null,
)

// --- Pairing ---

@Serializable
data class PairingClaimRequest(
    val code: String,
    @SerialName("device_name") val deviceName: String,
    @SerialName("device_type") val deviceType: String,
)

@Serializable
data class PairingClaimResponse(
    @SerialName("device_id") val deviceId: String,
    @SerialName("device_token") val deviceToken: String,
    @SerialName("api_base_url") val apiBaseUrl: String,
    @SerialName("host_name") val hostName: String,
    @SerialName("server_version") val serverVersion: String,
)

// --- Auth ---

@Serializable
data class LoginRequest(val pin: String)

@Serializable
data class LoginResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresIn: Int,
)

// --- Todos ---

@Immutable
@Serializable
data class Todo(
    val id: String,
    val title: String,
    val description: String? = null,
    val status: String = "pending",
    val priority: String = "medium",
    @SerialName("due_date") val dueDate: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    val tags: List<String>? = null,
    @SerialName("parent_id") val parentId: String? = null,
    @SerialName("sort_order") val sortOrder: Int = 0,
    val source: String? = null,
    val assignee: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class TodoCreate(
    val title: String,
    val description: String? = null,
    val priority: String = "medium",
    @SerialName("due_date") val dueDate: String? = null,
    val tags: List<String>? = null,
    @SerialName("parent_id") val parentId: String? = null,
)

@Serializable
data class TodoUpdate(
    val title: String? = null,
    val description: String? = null,
    val status: String? = null,
    val priority: String? = null,
    @SerialName("due_date") val dueDate: String? = null,
    val tags: List<String>? = null,
    @SerialName("sort_order") val sortOrder: Int? = null,
)

// --- Events ---

@Immutable
@Serializable
data class Event(
    val id: String,
    val title: String,
    val description: String? = null,
    @SerialName("start_time") val startTime: String,
    @SerialName("end_time") val endTime: String? = null,
    val location: String? = null,
    @SerialName("is_all_day") val isAllDay: Boolean = false,
    @SerialName("reminder_minutes") val reminderMinutes: Int? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

// --- Conversations ---

@Immutable
@Serializable
data class Conversation(
    val id: String,
    val title: String,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    @SerialName("project_todo_id") val projectTodoId: String? = null,
)

@Immutable
@Serializable
data class Message(
    val id: String,
    val content: String,
    val role: String, // "user" | "assistant" | "system"
    @SerialName("created_at") val createdAt: String = "",
    val intent: String? = null,
)

// --- Paginated Response ---

@Serializable
data class PaginatedResponse<T>(
    val items: List<T>,
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 50,
)

// --- Today ---

@Serializable
data class TodayResponse(
    val greeting: String = "",
    @SerialName("today_todos") val todayTodos: List<Todo> = emptyList(),
    @SerialName("overdue_todos") val overdueTodos: List<Todo> = emptyList(),
    @SerialName("today_events") val todayEvents: List<Event> = emptyList(),
    @SerialName("inbox_count") val inboxCount: Int = 0,
)

// --- Devices ---

@Immutable
@Serializable
data class PairedDevice(
    val id: String,
    val name: String,
    @SerialName("device_type") val deviceType: String,
    @SerialName("paired_at") val pairedAt: String,
    @SerialName("last_seen") val lastSeen: String,
    @SerialName("is_active") val isActive: Boolean,
)

@Serializable
data class DeviceListResponse(
    val devices: List<PairedDevice>,
)

// --- Settings ---

@Serializable
data class SettingsResponse(
    val theme: String? = null,
    @SerialName("font_size") val fontSize: String? = null,
    @SerialName("send_on_enter") val sendOnEnter: Boolean? = null,
    @SerialName("notifications_enabled") val notificationsEnabled: Boolean? = null,
)
