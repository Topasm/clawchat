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

export const TodoResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: TodoStatusSchema,
  priority: PrioritySchema.optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  completed_at: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
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
});

export const KanbanStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

// -- Events -----------------------------------------------------------------

export const EventResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  start_time: z.string(),
  end_time: z.string().optional(),
  location: z.string().optional(),
  is_all_day: z.boolean().optional(),
  reminder_minutes: z.number().optional(),
  recurrence_rule: z.string().optional(),
  recurrence_end: z.string().optional(),
  is_occurrence: z.boolean().optional(),
  occurrence_date: z.string().optional(),
  recurring_event_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
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

// -- Memos ------------------------------------------------------------------

export const MemoResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const MemoCreateSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  tags: z.array(z.string()).optional(),
});

export const MemoUpdateSchema = z.object({
  content: z.string().min(1, 'Content is required').optional(),
  tags: z.array(z.string()).optional(),
});

// -- Chat -------------------------------------------------------------------

export const ConversationResponseSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  last_message: z.string().optional(),
  is_archived: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ConversationCreateSchema = z.object({
  title: z.string().optional(),
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
  ai_provider: z.string(),
  ai_model: z.string(),
  ai_connected: z.boolean(),
});

// -- Tags -------------------------------------------------------------------

export const TagsResponseSchema = z.object({
  tags: z.array(z.string()),
});

// -- Briefing ---------------------------------------------------------------

export const BriefingResponseSchema = z.object({
  briefing: z.string(),
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
export type KanbanStatus = z.infer<typeof KanbanStatusSchema>;

export type EventResponse = z.infer<typeof EventResponseSchema>;
export type EventCreate = z.infer<typeof EventCreateSchema>;
export type EventUpdate = z.infer<typeof EventUpdateSchema>;

export type MemoResponse = z.infer<typeof MemoResponseSchema>;
export type MemoCreate = z.infer<typeof MemoCreateSchema>;
export type MemoUpdate = z.infer<typeof MemoUpdateSchema>;

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
export type TagsResponse = z.infer<typeof TagsResponseSchema>;
export type BriefingResponse = z.infer<typeof BriefingResponseSchema>;

// -- Task Relationships -----------------------------------------------------

export const RelationshipTypeSchema = z.enum(['blocks', 'blocked_by', 'related', 'duplicate_of']);

export const TaskRelationshipResponseSchema = z.object({
  id: z.string(),
  source_todo_id: z.string(),
  target_todo_id: z.string(),
  relationship_type: RelationshipTypeSchema,
  created_at: z.string(),
});

export const TaskRelationshipCreateSchema = z.object({
  source_todo_id: z.string(),
  target_todo_id: z.string(),
  relationship_type: RelationshipTypeSchema,
});

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

export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;
export type TaskRelationshipResponse = z.infer<typeof TaskRelationshipResponseSchema>;
export type TaskRelationshipCreate = z.infer<typeof TaskRelationshipCreateSchema>;
export type BulkTodoUpdate = z.infer<typeof BulkTodoUpdateSchema>;
export type BulkTodoResponse = z.infer<typeof BulkTodoResponseSchema>;

// -- Attachments ------------------------------------------------------------

export const AttachmentResponseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  stored_filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  memo_id: z.string().nullable().optional(),
  todo_id: z.string().nullable().optional(),
  url: z.string(),
  created_at: z.string(),
});

export type AttachmentResponse = z.infer<typeof AttachmentResponseSchema>;

// -- Admin Dashboard --------------------------------------------------------

export const ServerOverviewSchema = z.object({
  uptime_seconds: z.number(),
  version: z.string(),
  ai_provider: z.string(),
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
  memos: z.number(),
  agent_tasks: z.number(),
  attachments: z.number(),
  task_relationships: z.number(),
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
  provider: z.string(),
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
  status: z.string(),
  instruction: z.string(),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  created_at: z.string(),
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
  ai_provider: z.string(),
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
