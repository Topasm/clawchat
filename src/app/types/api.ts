// ---------------------------------------------------------------------------
// API request/response interfaces matching server Pydantic schemas
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

// -- Auth -------------------------------------------------------------------

export interface LoginRequest {
  pin: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

// -- Todos ------------------------------------------------------------------

export interface TodoResponse {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'completed';
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  due_date?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface TodoCreate {
  title: string;
  description?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  due_date?: string;
  tags?: string[];
}

export interface TodoUpdate {
  title?: string;
  description?: string;
  status?: 'pending' | 'completed';
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  due_date?: string;
  tags?: string[];
}

export type KanbanStatus = 'pending' | 'in_progress' | 'completed';

// -- Events -----------------------------------------------------------------

export interface EventResponse {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time?: string;
  location?: string;
  created_at: string;
  updated_at: string;
}

export interface EventCreate {
  title: string;
  description?: string;
  start_time: string;
  end_time?: string;
  location?: string;
}

export interface EventUpdate {
  title?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
}

// -- Memos ------------------------------------------------------------------

export interface MemoResponse {
  id: string;
  content: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface MemoCreate {
  content: string;
  tags?: string[];
}

export interface MemoUpdate {
  content?: string;
  tags?: string[];
}

// -- Chat -------------------------------------------------------------------

export interface ConversationResponse {
  id: string;
  title?: string;
  last_message?: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationCreate {
  title?: string;
}

export interface MessageResponse {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface SendMessageRequest {
  conversation_id: string;
  content: string;
}

// -- SSE stream events ------------------------------------------------------

export interface StreamEventMeta {
  conversation_id: string;
  message_id: string;
}

export interface StreamEventToken {
  token: string;
}

// -- Today ------------------------------------------------------------------

export interface TodayResponse {
  today_tasks: TodoResponse[];
  overdue_tasks: TodoResponse[];
  today_events: EventResponse[];
  inbox_count: number;
  greeting: string;
  date: string;
}
