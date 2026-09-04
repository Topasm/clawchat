package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

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
    @SerialName("host_id") val hostId: String,
    @SerialName("host_public_key") val hostPublicKey: String,
    @SerialName("relay_url") val relayUrl: String? = null,
)

// --- Auth ---

@Serializable
data class LoginRequest(val pin: String)

@Serializable
data class RefreshRequest(
    @SerialName("refresh_token") val refreshToken: String,
)

@Serializable
data class LoginResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresIn: Int,
)

// --- Todos ---

@Serializable
data class Todo(
    val id: String,
    val title: String,
    val description: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    val status: TaskStatus = TaskStatus.PENDING,
    val priority: String = "medium",
    @SerialName("due_date") val dueDate: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    val tags: List<String>? = null,
    @SerialName("parent_id") val parentId: String? = null,
    @SerialName("sort_order") val sortOrder: Int = 0,
    val source: String? = null,
    @SerialName("idempotency_key") val idempotencyKey: String? = null,
    val assignee: String? = null,
    @SerialName("inbox_state") val inboxState: String? = null,
    @SerialName("estimated_minutes") val estimatedMinutes: Int? = null,
    @SerialName("automation_error") val automationError: String? = null,
    @SerialName("source_id") val sourceId: String? = null,
    @SerialName("next_action") val nextAction: String? = null,
    @SerialName("plan_summary") val planSummary: String? = null,
    @SerialName("clarification_questions") val clarificationQuestions: List<String>? = null,
    @SerialName("clarification_answers") val clarificationAnswers: Map<String, String>? = null,
    @SerialName("sync_status") val syncStatus: String? = null,
    @SerialName("project_label") val projectLabel: String? = null,
    @SerialName("is_recurring") val isRecurring: Boolean = false,
    @SerialName("recurrence_rule") val recurrenceRule: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class TodoCreate(
    val title: String,
    val description: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    val status: TaskStatus = TaskStatus.PENDING,
    val priority: String = "medium",
    @SerialName("due_date") val dueDate: String? = null,
    val tags: List<String>? = null,
    @SerialName("parent_id") val parentId: String? = null,
    @SerialName("sort_order") val sortOrder: Int? = null,
    val source: String? = null,
    @SerialName("source_id") val sourceId: String? = null,
    val assignee: String? = null,
    @SerialName("inbox_state") val inboxState: String? = null,
    @SerialName("estimated_minutes") val estimatedMinutes: Int? = null,
    /** Stable operation identity so a retried quick capture cannot create a duplicate. */
    @SerialName("idempotency_key") val idempotencyKey: String? = null,
)

@Serializable
data class TodoUpdate(
    val title: String? = null,
    val description: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    val status: TaskStatus? = null,
    val priority: String? = null,
    @SerialName("due_date") val dueDate: String? = null,
    val tags: List<String>? = null,
    @SerialName("parent_id") val parentId: String? = null,
    @SerialName("sort_order") val sortOrder: Int? = null,
    val assignee: String? = null,
    @SerialName("inbox_state") val inboxState: String? = null,
    @SerialName("estimated_minutes") val estimatedMinutes: Int? = null,
    val source: String? = null,
    @SerialName("source_id") val sourceId: String? = null,
    /** Device edit time used by the server's last-write-wins reconnect policy. */
    @SerialName("client_updated_at") val clientUpdatedAt: String? = null,
)

@Serializable
data class TodoQuestionAnswersRequest(
    val answers: Map<String, String>,
)

@Serializable
data class TodoWorkflowResponse(
    val status: String,
    @SerialName("todo_id") val todoId: String,
    @SerialName("inbox_state") val inboxState: String? = null,
)

// --- Events ---

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
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("recurrence_rule") val recurrenceRule: String? = null,
    @SerialName("recurrence_end") val recurrenceEnd: String? = null,
    /**
     * True for a repeat the server expanded in memory. Such an entry shares
     * [id] with the stored event it repeats, so [occurrenceDate] is what tells
     * two repeats apart.
     */
    @SerialName("is_occurrence") val isOccurrence: Boolean = false,
    @SerialName("occurrence_date") val occurrenceDate: String? = null,
    @SerialName("recurring_event_id") val recurringEventId: String? = null,
    val tags: List<String>? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
) {
    /** Stable identity for a list key: a repeat is not its own row on the server. */
    val occurrenceKey: String get() = occurrenceDate?.let { "$id@$it" } ?: id
}

@Serializable
data class EventCreate(
    val title: String,
    val description: String? = null,
    @SerialName("start_time") val startTime: String,
    @SerialName("end_time") val endTime: String? = null,
    val location: String? = null,
    @SerialName("is_all_day") val isAllDay: Boolean = false,
    @SerialName("reminder_minutes") val reminderMinutes: Int? = null,
    @SerialName("recurrence_rule") val recurrenceRule: String? = null,
)

/**
 * Only the fields set here are sent, and the server updates exactly those, so
 * a null stays "leave it alone" rather than "clear it".
 */
@Serializable
data class EventUpdate(
    val title: String? = null,
    val description: String? = null,
    @SerialName("start_time") val startTime: String? = null,
    @SerialName("end_time") val endTime: String? = null,
    val location: String? = null,
    @SerialName("is_all_day") val isAllDay: Boolean? = null,
    @SerialName("reminder_minutes") val reminderMinutes: Int? = null,
    @SerialName("recurrence_rule") val recurrenceRule: String? = null,
)

// --- Search ---

/** One full-text search result. [type] is `message`, `todo`, or `event`. */
@Serializable
data class SearchHit(
    val type: String,
    val id: String,
    val title: String? = null,
    val preview: String = "",
    val rank: Double = 0.0,
    @SerialName("created_at") val createdAt: String = "",
)

// --- Conversations ---

@Serializable
data class Conversation(
    val id: String,
    val title: String,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    @SerialName("project_todo_id") val projectTodoId: String? = null,
    val metadata: JsonObject? = null,
) {
    val isAgentRun: Boolean
        get() = metadata?.get("origin")?.jsonPrimitive?.contentOrNull == "agent_run"
}

@Serializable
data class Message(
    val id: String,
    val content: String,
    val role: String, // "user" | "assistant" | "system"
    @SerialName("created_at") val createdAt: String = "",
    val intent: String? = null,
    /** Action card payload; `action_type = "run_update"` is an agent run reporting into its thread. */
    val metadata: JsonObject? = null,
) {
    private val actionType: String?
        get() = metadata?.get("action_type")?.jsonPrimitive?.contentOrNull

    val runUpdate: RunUpdate?
        get() = metadata?.takeIf { actionType == "run_update" }
            ?.let { data ->
                RunUpdate(
                    runId = data["run_id"]?.jsonPrimitive?.contentOrNull,
                    status = data["status"]?.jsonPrimitive?.contentOrNull ?: "running",
                    title = data["title"]?.jsonPrimitive?.contentOrNull,
                    error = data["error"]?.jsonPrimitive?.contentOrNull,
                    reviewId = data["review_id"]?.jsonPrimitive?.contentOrNull,
                    inputOptions = data["input_options"]?.jsonArray
                        ?.mapNotNull { it.jsonPrimitive.contentOrNull }
                        .orEmpty(),
                    hasPendingPermissions = data["permissions"]?.jsonArray?.isNotEmpty() == true,
                )
            }

    val taskDelegation: TaskDelegation?
        get() = metadata?.takeIf { actionType == "task_delegated" }?.let { data ->
            TaskDelegation(
                taskId = data["task_id"]?.jsonPrimitive?.contentOrNull ?: return@let null,
                runId = data["run_id"]?.jsonPrimitive?.contentOrNull,
                isMultiAgent = data["is_multi_agent"]?.jsonPrimitive?.booleanOrNull == true,
            )
        }
}

/** What a `run_update` chat message says about its run. */
data class RunUpdate(
    val runId: String?,
    val status: String,
    val title: String?,
    val error: String?,
    val reviewId: String?,
    val inputOptions: List<String>,
    val hasPendingPermissions: Boolean,
) {
    val needsUser: Boolean
        get() = status == "waiting_input" || status == "waiting_review"
}

data class TaskDelegation(
    val taskId: String,
    val runId: String?,
    val isMultiAgent: Boolean,
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
    @SerialName("today_tasks") val todayTodos: List<Todo> = emptyList(),
    @SerialName("overdue_tasks") val overdueTodos: List<Todo> = emptyList(),
    @SerialName("today_events") val todayEvents: List<Event> = emptyList(),
    // Pending tasks with no due date at all — neither "today" nor "overdue"
    // claims them, so without this they never surface anywhere.
    @SerialName("needs_date_tasks") val needsDateTodos: List<Todo> = emptyList(),
    @SerialName("inbox_count") val inboxCount: Int = 0,
)

// --- Briefing ---

@Serializable
data class BriefingSuggestion(
    val action: String = "",
    @SerialName("todo_id") val todoId: String? = null,
    val title: String = "",
    val reason: String = "",
)

@Serializable
data class BriefingResponse(
    val summary: String = "",
    val suggestions: List<BriefingSuggestion> = emptyList(),
    @SerialName("load_assessment") val loadAssessment: String = "moderate",
    @SerialName("load_message") val loadMessage: String = "",
    val highlights: List<String> = emptyList(),
    val date: String = "",
)

// --- Devices ---

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
