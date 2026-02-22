// ---------------------------------------------------------------------------
// API request/response types — re-exported from Zod schemas for validation
// All existing `import { ... } from '../types/api'` continue working unchanged
// ---------------------------------------------------------------------------

export type {
  TodoResponse,
  TodoCreate,
  TodoUpdate,
  KanbanStatus,
  EventResponse,
  EventCreate,
  EventUpdate,
  MemoResponse,
  MemoCreate,
  MemoUpdate,
  ConversationResponse,
  StreamEventMeta,
  SettingsPayload,
  HealthResponse,
  TaskRelationshipCreate,
  BulkTodoUpdate,
  AttachmentResponse,
  AdminOverviewResponse,
  AIConfigResponse,
  AITestResponse,
  ActivityResponse,
  SessionsResponse,
  ServerConfigResponse,
  DataOverviewResponse,
  PurgeResponse,
  ReindexResponse,
  BackupResponse,
} from './schemas';
