import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas mirroring server Pydantic models
// Each schema validates API responses; inferred types replace manual interfaces
// ---------------------------------------------------------------------------

// -- Auth -------------------------------------------------------------------

export const LoginRequestSchema = z.object({
  pin: z.string().min(1, 'PIN is required'),
});

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
});

export const RefreshRequestSchema = z.object({
  refresh_token: z.string(),
});

// -- Todos ------------------------------------------------------------------

const TodoStatusSchema = z.enum(['pending', 'completed']);
const PrioritySchema = z.enum(['urgent', 'high', 'medium', 'low']);
const InboxStateSchema = z.enum(['none', 'classifying', 'captured', 'questioning', 'planning', 'plan_ready', 'error']);

export const TodoResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: TodoStatusSchema,
  priority: PrioritySchema.optional(),
  due_date: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  completed_at: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  source: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  enabled_skills: z.array(z.string()).nullable().optional(),
  inbox_state: InboxStateSchema.optional(),
  estimated_minutes: z.number().nullable().optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrence_end: z.string().nullable().optional(),
  is_recurring: z.boolean().optional(),
  recurring_source_id: z.string().nullable().optional(),
  next_action: z.string().nullable().optional(),
  plan_summary: z.string().nullable().optional(),
  sync_status: z.string().nullable().optional(),
  project_label: z.string().nullable().optional(),
  depends_on: z.array(z.string()).nullable().optional(),
  clarification_questions: z.array(z.string()).nullable().optional(),
  clarification_answers: z.record(z.string(), z.string()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const TodoCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  priority: PrioritySchema.optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  assignee: z.string().nullable().optional(),
  enabled_skills: z.array(z.string()).nullable().optional(),
  depends_on: z.array(z.string()).nullable().optional(),
  source: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  inbox_state: InboxStateSchema.optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrence_end: z.string().nullable().optional(),
});

export const TodoUpdateSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional(),
  status: TodoStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  assignee: z.string().nullable().optional(),
  enabled_skills: z.array(z.string()).nullable().optional(),
  depends_on: z.array(z.string()).nullable().optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrence_end: z.string().nullable().optional(),
});

export const ProjectTodoResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: TodoStatusSchema,
  priority: PrioritySchema.optional(),
  due_date: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  completed_at: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  source: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  enabled_skills: z.array(z.string()).nullable().optional(),
  inbox_state: InboxStateSchema.optional(),
  estimated_minutes: z.number().nullable().optional(),
  depends_on: z.array(z.string()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  conversation_id: z.string().nullable().optional(),
  subtask_count: z.number().optional(),
  completed_subtask_count: z.number().optional(),
});

export const KanbanStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

// -- Events -----------------------------------------------------------------

export const EventResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  start_time: z.string(),
  end_time: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  is_all_day: z.boolean().optional(),
  reminder_minutes: z.number().nullable().optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrence_end: z.string().nullable().optional(),
  is_occurrence: z.boolean().optional(),
  occurrence_date: z.string().nullable().optional(),
  recurring_event_id: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const EventCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  start_time: z.string().min(1, 'Start time is required'),
  end_time: z.string().optional(),
  location: z.string().optional(),
  is_all_day: z.boolean().optional(),
  reminder_minutes: z.number().optional(),
  recurrence_rule: z.string().optional(),
  recurrence_end: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const EventUpdateSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  location: z.string().optional(),
  is_all_day: z.boolean().optional(),
  reminder_minutes: z.number().optional(),
  tags: z.array(z.string()).optional(),
});

// -- Chat -------------------------------------------------------------------

export const ConversationResponseSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  last_message: z.string().optional(),
  is_archived: z.boolean().optional(),
  project_todo_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ConversationCreateSchema = z.object({
  title: z.string().optional(),
  project_todo_id: z.string().optional(),
});

export const MessageResponseSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  intent: z.string().optional(),
  message_type: z.string().optional(),
  created_at: z.string(),
});

export const SendMessageRequestSchema = z.object({
  conversation_id: z.string(),
  content: z.string().min(1, 'Message is required'),
});

// -- SSE stream events ------------------------------------------------------

export const StreamEventMetaSchema = z.object({
  conversation_id: z.string(),
  message_id: z.string(),
});

export const StreamEventTokenSchema = z.object({
  token: z.string(),
});

// -- Search -----------------------------------------------------------------

export const SearchHitSchema = z.object({
  type: z.string(),
  id: z.string(),
  title: z.string().nullable().optional(),
  preview: z.string(),
  rank: z.number(),
  created_at: z.string(),
});

export const SearchResponseSchema = z.object({
  items: z.array(SearchHitSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

// -- Today ------------------------------------------------------------------

export const TodayResponseSchema = z.object({
  today_tasks: z.array(TodoResponseSchema),
  overdue_tasks: z.array(TodoResponseSchema),
  today_events: z.array(EventResponseSchema),
  inbox_count: z.number(),
  greeting: z.string(),
  date: z.string(),
});

// -- Settings ---------------------------------------------------------------

export const SettingsPayloadSchema = z.object({
  fontSize: z.number().optional(),
  messageBubbleStyle: z.string().optional(),
  sendOnEnter: z.boolean().optional(),
  showTimestamps: z.boolean().optional(),
  showAvatars: z.boolean().optional(),
  llmModel: z.string().optional(),
  temperature: z.number().optional(),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().optional(),
  streamResponses: z.boolean().optional(),
  theme: z.string().optional(),
  compactMode: z.boolean().optional(),
  sidebarSize: z.number().optional(),
  chatPanelSize: z.number().optional(),
  notificationsEnabled: z.boolean().optional(),
  reminderSound: z.boolean().optional(),
  saveHistory: z.boolean().optional(),
  analyticsEnabled: z.boolean().optional(),
});

export const SettingsResponseSchema = z.object({
  settings: SettingsPayloadSchema,
  updated_at: z.string(),
});

// -- Health -----------------------------------------------------------------

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  ai_backend: z.string(),
  ai_model: z.string(),
  ai_connected: z.boolean(),
});

// -- Capabilities -----------------------------------------------------------

export const AICapabilitySchema = z.object({
  provider: z.string().nullable(),
  model: z.string(),
  available: z.boolean(),
});

export const FeaturesCapabilitySchema = z.object({
  obsidian: z.boolean(),
  calendar: z.boolean(),
  kanban: z.boolean(),
  inbox_pipeline: z.boolean(),
  skills: z.array(z.string()),
  agent_tasks: z.boolean(),
});

export const CapabilitiesResponseSchema = z.object({
  ai: AICapabilitySchema,
  features: FeaturesCapabilitySchema,
  version: z.string(),
});

// -- Tags -------------------------------------------------------------------

export const TagsResponseSchema = z.object({
  tags: z.array(z.string()),
});

// -- Briefing ---------------------------------------------------------------

export const BriefingSuggestionSchema = z.object({
  action: z.string(),
  todo_id: z.string(),
  title: z.string(),
  reason: z.string(),
});

export const BriefingResponseSchema = z.object({
  summary: z.string().optional(),
  briefing: z.string().optional(), // backward compat
  highlights: z.array(z.string()).optional(),
  suggestions: z.array(BriefingSuggestionSchema).optional(),
  load_assessment: z.enum(['light', 'moderate', 'heavy']).optional(),
  load_message: z.string().optional(),
  stats: z.record(z.string(), z.number()).optional(),
  date: z.string(),
});

// ---------------------------------------------------------------------------
// Inferred types — these replace the manual interfaces in api.ts
// ---------------------------------------------------------------------------

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export type TodoResponse = z.infer<typeof TodoResponseSchema>;
export type TodoCreate = z.infer<typeof TodoCreateSchema>;
export type TodoUpdate = z.infer<typeof TodoUpdateSchema>;
export type ProjectTodoResponse = z.infer<typeof ProjectTodoResponseSchema>;
export type KanbanStatus = z.infer<typeof KanbanStatusSchema>;

export type EventResponse = z.infer<typeof EventResponseSchema>;
export type EventCreate = z.infer<typeof EventCreateSchema>;
export type EventUpdate = z.infer<typeof EventUpdateSchema>;

export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;
export type ConversationCreate = z.infer<typeof ConversationCreateSchema>;
export type MessageResponse = z.infer<typeof MessageResponseSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export type StreamEventMeta = z.infer<typeof StreamEventMetaSchema>;
export type StreamEventToken = z.infer<typeof StreamEventTokenSchema>;

export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type TodayResponse = z.infer<typeof TodayResponseSchema>;

export type SettingsPayload = z.infer<typeof SettingsPayloadSchema>;
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;
export type TagsResponse = z.infer<typeof TagsResponseSchema>;
export type BriefingResponse = z.infer<typeof BriefingResponseSchema>;

// -- Bulk Operations --------------------------------------------------------

export const BulkTodoUpdateSchema = z.object({
  ids: z.array(z.string()).min(1),
  status: TodoStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  tags: z.array(z.string()).optional(),
  delete: z.boolean().optional(),
});

export const BulkTodoResponseSchema = z.object({
  updated: z.number(),
  deleted: z.number(),
  errors: z.array(z.string()),
});

export type BulkTodoUpdate = z.infer<typeof BulkTodoUpdateSchema>;
export type BulkTodoResponse = z.infer<typeof BulkTodoResponseSchema>;

// -- Attachments ------------------------------------------------------------

export const AttachmentResponseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  stored_filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  todo_id: z.string().nullable().optional(),
  url: z.string(),
  created_at: z.string(),
});

export type AttachmentResponse = z.infer<typeof AttachmentResponseSchema>;

// -- Admin Dashboard --------------------------------------------------------

export const ServerOverviewSchema = z.object({
  uptime_seconds: z.number(),
  version: z.string(),
  ai_backend: z.string(),
  ai_model: z.string(),
  ai_base_url: z.string(),
  ai_connected: z.boolean(),
  active_ws_connections: z.number(),
  scheduler_enabled: z.boolean(),
  scheduler_running: z.boolean(),
});

export const TableCountsSchema = z.object({
  conversations: z.number(),
  messages: z.number(),
  todos: z.number(),
  events: z.number(),
  agent_tasks: z.number(),
  attachments: z.number(),
});

export const StorageStatsSchema = z.object({
  db_size_bytes: z.number(),
  upload_dir_size_bytes: z.number(),
  attachment_count: z.number(),
  attachment_total_bytes: z.number(),
});

export const AdminOverviewResponseSchema = z.object({
  server: ServerOverviewSchema,
  counts: TableCountsSchema,
  storage: StorageStatsSchema,
});

export const AIConfigResponseSchema = z.object({
  backend: z.string(),
  model: z.string(),
  base_url: z.string(),
  connected: z.boolean(),
  available_models: z.array(z.string()),
});

export const AITestResponseSchema = z.object({
  connected: z.boolean(),
  latency_ms: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const RecentActivitySchema = z.object({
  type: z.string(),
  id: z.string(),
  summary: z.string(),
  created_at: z.string(),
});

export const AgentTaskSummarySchema = z.object({
  id: z.string(),
  task_type: z.string(),
  agent_type: z.string(),
  skill_chain: z.array(z.string()).nullable().optional(),
  status: z.string(),
  instruction: z.string(),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  created_at: z.string(),
  completed_at: z.string().nullable().optional(),
});

export const AgentTaskResponseSchema = z.object({
  id: z.string(),
  task_type: z.string(),
  instruction: z.string(),
  status: z.string(),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  parent_task_id: z.string().nullable().optional(),
  agent_type: z.string().optional(),
  skill_chain: z.array(z.string()).nullable().optional(),
  current_skill_index: z.number().optional(),
  progress: z.number().optional(),
  progress_message: z.string().nullable().optional(),
  sub_task_count: z.number().optional(),
  completed_sub_tasks: z.number().optional(),
  todo_id: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  conversation_id: z.string().nullable().optional(),
  message_id: z.string().nullable().optional(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
});

export const ActivityResponseSchema = z.object({
  recent: z.array(RecentActivitySchema),
  agent_tasks: z.array(AgentTaskSummarySchema),
});

export const ActiveSessionSchema = z.object({
  user_id: z.string(),
  connected: z.boolean(),
});

export const SessionsResponseSchema = z.object({
  active_connections: z.array(ActiveSessionSchema),
  total_connections: z.number(),
});

export const ServerConfigResponseSchema = z.object({
  host: z.string(),
  port: z.number(),
  database_url: z.string(),
  jwt_expiry_hours: z.number(),
  ai_backend: z.string(),
  ai_base_url: z.string(),
  ai_model: z.string(),
  upload_dir: z.string(),
  max_upload_size_mb: z.number(),
  allowed_extensions: z.string(),
  enable_scheduler: z.boolean(),
  briefing_time: z.string(),
  reminder_check_interval: z.number(),
  debug: z.boolean(),
});

export const ModuleDataOverviewSchema = z.object({
  name: z.string(),
  count: z.number(),
  oldest: z.string().nullable().optional(),
  newest: z.string().nullable().optional(),
});

export const DataOverviewResponseSchema = z.object({
  modules: z.array(ModuleDataOverviewSchema),
});

export const PurgeResponseSchema = z.object({
  deleted_count: z.number(),
  target: z.string(),
});

export const ReindexResponseSchema = z.object({
  status: z.string(),
  tables_reindexed: z.array(z.string()),
});

export const BackupResponseSchema = z.object({
  filename: z.string(),
  size_bytes: z.number(),
});

export const PlanSubtaskSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  estimated_minutes: z.number().nullable().optional(),
  due_date: z.string().nullable().optional(),
  depends_on_indices: z.array(z.number()).optional(),
});

export const PlanResponseSchema = z.object({
  task_id: z.string(),
  todo_id: z.string(),
  summary: z.string(),
  suggested_root_due_date: z.string().nullable().optional(),
  suggested_assignee: z.string().nullable().optional(),
  suggested_skills: z.array(z.string()).nullable().optional(),
  suggested_project_title: z.string().nullable().optional(),
  subtasks: z.array(PlanSubtaskSchema).optional(),
  subtask_count: z.number().optional(),
  suggested_due_summary: z.string().nullable().optional(),
  suggested_assignee_label: z.string().nullable().optional(),
  suggested_skills_labels: z.array(z.string()).nullable().optional(),
  suggested_project_label: z.string().nullable().optional(),
  created_at: z.string(),
});

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
});

export const SkillsResponseSchema = z.object({
  skills: z.array(SkillSchema),
});

export const PlanApplyResponseSchema = z.object({
  todo_id: z.string(),
  created_subtask_ids: z.array(z.string()).optional(),
  created_relationships: z.number().optional(),
  project_folder_created: z.string().nullable().optional(),
});

export type AdminOverviewResponse = z.infer<typeof AdminOverviewResponseSchema>;
export type AIConfigResponse = z.infer<typeof AIConfigResponseSchema>;
export type AITestResponse = z.infer<typeof AITestResponseSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
export type RecentActivity = z.infer<typeof RecentActivitySchema>;
export type AgentTaskSummary = z.infer<typeof AgentTaskSummarySchema>;
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>;
export type ServerConfigResponse = z.infer<typeof ServerConfigResponseSchema>;
export type DataOverviewResponse = z.infer<typeof DataOverviewResponseSchema>;
export type ModuleDataOverview = z.infer<typeof ModuleDataOverviewSchema>;
export type PurgeResponse = z.infer<typeof PurgeResponseSchema>;
export type ReindexResponse = z.infer<typeof ReindexResponseSchema>;
export type BackupResponse = z.infer<typeof BackupResponseSchema>;

export type InboxState = z.infer<typeof InboxStateSchema>;
export type AgentTaskResponse = z.infer<typeof AgentTaskResponseSchema>;
export type PlanSubtask = z.infer<typeof PlanSubtaskSchema>;
export type PlanResponse = z.infer<typeof PlanResponseSchema>;
export type PlanApplyResponse = z.infer<typeof PlanApplyResponseSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SkillsResponse = z.infer<typeof SkillsResponseSchema>;

// ---------------------------------------------------------------------------
// Obsidian vault integration
// ---------------------------------------------------------------------------

export const ObsidianStatusSchema = z.object({
  enabled: z.boolean(),
  vault_path: z.string(),
  last_sync: z.string().nullable(),
  db_task_count: z.number(),
  cli_available: z.boolean(),
  mode: z.enum(['cli', 'filesystem', 'disabled']),
});

export const ObsidianHealthSchema = z.object({
  vault_available: z.boolean(),
  vault_path: z.string(),
  cli_available: z.boolean(),
  companion_online: z.boolean(),
  sync_mode: z.string(),
  project_count: z.number(),
  last_scan: z.number().nullable(),
  scan_duration_ms: z.number(),
  is_stale: z.boolean(),
  error: z.string().nullable(),
  write_queue: z.object({
    pending: z.number(),
    operations: z.array(z.object({
      op: z.string(),
      path: z.string(),
      queued_at: z.number(),
      retries: z.number(),
      error: z.string().nullable(),
    })),
  }),
  bidirectional_sync: z.object({
    last_scan: z.number().nullable(),
    files_scanned: z.number(),
    markers_found: z.number(),
    changes_detected: z.number().optional(),
    changes_applied: z.number(),
    errors: z.number(),
    duration_ms: z.number().optional(),
    sync_lag_seconds: z.number().nullable(),
  }),
});

export const ObsidianProjectSchema = z.object({
  folder: z.string(),
  name: z.string(),
  todo_md_preview: z.string(),
  doc_count: z.number(),
  last_modified: z.number().nullable(),
});

export const ObsidianProjectsResponseSchema = z.object({
  projects: z.array(ObsidianProjectSchema),
  total: z.number(),
  index_age_seconds: z.number().nullable(),
});

export const ObsidianScanResultSchema = z.object({
  files_scanned: z.number(),
  markers_found: z.number(),
  changes_detected: z.number(),
  changes_applied: z.number(),
  errors: z.number(),
  duration_ms: z.number(),
});

export type ObsidianStatus = z.infer<typeof ObsidianStatusSchema>;
export type ObsidianHealth = z.infer<typeof ObsidianHealthSchema>;
export type ObsidianProject = z.infer<typeof ObsidianProjectSchema>;
export type ObsidianProjectsResponse = z.infer<typeof ObsidianProjectsResponseSchema>;
export type ObsidianScanResult = z.infer<typeof ObsidianScanResultSchema>;
