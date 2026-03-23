// ---------------------------------------------------------------------------
// API request/response types — re-exported from Zod schemas for validation
// All existing `import { ... } from '../types/api'` continue working unchanged
// ---------------------------------------------------------------------------

export type {
  TodoResponse,
  TodoCreate,
  TodoUpdate,
  KanbanStatus,
  ProjectTodoResponse,
  EventResponse,
  EventCreate,
  EventUpdate,
  ConversationResponse,
  StreamEventMeta,
  SettingsPayload,
  HealthResponse,
  CapabilitiesResponse,
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
