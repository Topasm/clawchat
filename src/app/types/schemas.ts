import { z } from 'zod';
import {
  TASK_STATUSES,
  type TaskStatus as GeneratedTaskStatus,
} from '../generated/contracts/taskStatus';
import { TASK_RELATIONSHIP_TYPES } from '../generated/contracts/taskRelationshipType';

export { TASK_RELATIONSHIP_TYPES, TASK_STATUSES };

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
  host_id: z.string().nullable().optional(),
  host_public_key: z.string().nullable().optional(),
  api_version: z.string().optional(),
  workspace_name: z.string().optional(),
});

export const RefreshRequestSchema = z.object({
  refresh_token: z.string(),
});

// -- Todos ------------------------------------------------------------------

export const TaskStatusSchema = z.enum(TASK_STATUSES);
const InboxStateSchema = z.enum([
  'none',
  'classifying',
  'captured',
  'questioning',
  'planning',
  'plan_ready',
  'error',
]);

export const TodoResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  status: TaskStatusSchema,
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
  project_id: z.string().nullable().optional(),
  status: TaskStatusSchema.optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  assignee: z.string().nullable().optional(),
  enabled_skills: z.array(z.string()).nullable().optional(),
  depends_on: z.array(z.string()).nullable().optional(),
  estimated_minutes: z.number().int().nullable().optional(),
  source: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
  inbox_state: InboxStateSchema.optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrence_end: z.string().nullable().optional(),
});

export const TodoUpdateSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional(),
  project_id: z.string().nullable().optional(),
  status: TaskStatusSchema.optional(),
  due_date: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  assignee: z.string().nullable().optional(),
  enabled_skills: z.array(z.string()).nullable().optional(),
  depends_on: z.array(z.string()).nullable().optional(),
  estimated_minutes: z.number().int().nullable().optional(),
  source: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  inbox_state: InboxStateSchema.optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrence_end: z.string().nullable().optional(),
  client_updated_at: z.string().optional(),
});

export const TaskPlacementRequestSchema = z.object({
  project_id: z.string().nullable(),
  parent_id: z.string().nullable(),
  before_id: z.string().nullable().optional(),
  inbox_state: InboxStateSchema.nullable().optional(),
  expected_graph_revision: z.number().int().nonnegative(),
});

export const TaskPlacementResponseSchema = z.object({
  todo: TodoResponseSchema,
  graph_revision: z.number().int().nonnegative(),
  affected_task_ids: z.array(z.string()),
  insights_delta: z
    .object({
      ready_count: z.number().int(),
      blocked_count: z.number().int(),
      critical_path_minutes: z.number().int().nullable(),
    })
    .nullable()
    .optional(),
  change_set_id: z.string(),
  reverted: z.boolean().optional(),
});

export const TaskBatchPlacementRequestSchema = TaskPlacementRequestSchema.extend({
  todo_ids: z.array(z.string().min(1)).min(1).max(100),
});

export const TaskBatchPlacementResponseSchema = z.object({
  todos: z.array(TodoResponseSchema),
  created_todos: z.array(TodoResponseSchema).optional().default([]),
  graph_revision: z.number().int().nonnegative(),
  affected_task_ids: z.array(z.string()),
  insights_delta: z
    .object({
      ready_count: z.number().int(),
      blocked_count: z.number().int(),
      critical_path_minutes: z.number().int().nullable(),
    })
    .nullable()
    .optional(),
  change_set_id: z.string(),
});

export const TaskPlacementGroupSchema = z.object({
  todo_ids: z.array(z.string().min(1)).min(1).max(100),
  project_id: z.string().nullable(),
  parent_id: z.string().nullable(),
  before_id: z.string().nullable().optional(),
  create_parent: z
    .object({
      title: z.string().min(1).max(200),
      description: z.string().nullable().optional(),
      parent_id: z.string().nullable(),
    })
    .nullable()
    .optional(),
  inbox_state: InboxStateSchema.nullable().optional(),
});

export const TaskGroupedPlacementRequestSchema = z.object({
  groups: z.array(TaskPlacementGroupSchema).min(1).max(20),
  expected_graph_revision: z.number().int().nonnegative(),
});

export const InboxTriagePreviewRequestSchema = z.object({
  todo_ids: z.array(z.string().min(1)).min(1).max(50),
  expected_graph_revision: z.number().int().nonnegative(),
});

export const InboxTriageSuggestionSchema = z.object({
  task_id: z.string(),
  project_id: z.string(),
  parent_id: z.string().nullable(),
  proposed_parent_key: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
});

export const InboxTriageProposedWorkstreamSchema = z.object({
  key: z.string(),
  project_id: z.string(),
  parent_id: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const InboxTriagePreviewResponseSchema = z.object({
  base_graph_revision: z.number().int().nonnegative(),
  suggestions: z.array(InboxTriageSuggestionSchema),
  proposed_workstreams: z.array(InboxTriageProposedWorkstreamSchema).optional().default([]),
  unassigned_task_ids: z.array(z.string()),
  model_provider: z.string().nullable().optional(),
});

export const ProjectTodoResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  status: TaskStatusSchema,
  due_date: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  completed_at: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  source: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
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

export const ProjectStatusSchema = z.enum(['planned', 'active', 'completed', 'archived']);

export const ProjectResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: ProjectStatusSchema,
  deadline: z.string().nullable().optional(),
  root_task_id: z.string().nullable().optional(),
  graph_revision: z.number().int().nonnegative(),
  default_execution_provider: z.string().nullable().optional(),
  default_execution_model: z.string().nullable().optional(),
  execution_workspace_path: z.string().nullable().optional(),
  execution_workspace_isolation: z.enum(['local', 'worktree']).default('local'),
  execution_base_branch: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  task_count: z.number().int().nonnegative(),
  completed_task_count: z.number().int().nonnegative(),
  conversation_id: z.string().nullable().optional(),
});

export const ProjectOverviewResponseSchema = ProjectResponseSchema.extend({
  ready_count: z.number().int().nonnegative(),
  blocked_count: z.number().int().nonnegative(),
  at_risk_count: z.number().int().nonnegative(),
  running_agent_count: z.number().int().nonnegative(),
  pending_review_count: z.number().int().nonnegative(),
  critical_path_minutes: z.number().int().nonnegative().nullable(),
});

export const ProjectCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  goal: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: ProjectStatusSchema.optional(),
  deadline: z.string().nullable().optional(),
  default_execution_provider: z.string().nullable().optional(),
  default_execution_model: z.string().nullable().optional(),
  execution_workspace_path: z.string().nullable().optional(),
  execution_workspace_isolation: z.enum(['local', 'worktree']).optional(),
  execution_base_branch: z.string().nullable().optional(),
});

export const ProjectUpdateSchema = ProjectCreateSchema.partial();

export const ReviewSubjectTypeSchema = z.enum([
  'plan_proposal',
  'artifact_revision',
  'agent_run',
  'code_diff',
  'schedule_change',
  'sync_conflict',
]);
export const ReviewStatusSchema = z.enum([
  'pending',
  'approved',
  'changes_requested',
  'rejected',
  'expired',
]);
export const ReviewRiskLevelSchema = z.enum(['low', 'medium', 'high']);
export const ReviewReadyTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
});
export const AgentRunApprovalImpactSchema = z.object({
  todo_id: z.string().nullable(),
  graph_revision: z.number().int().nonnegative(),
  newly_ready_tasks: z.array(ReviewReadyTaskSchema),
});
export const AgentRunReviewOutcomeSchema = z
  .object({
    run_id: z.string().optional(),
    agent_task_id: z.string().optional(),
    todo_id: z.string().nullable().optional(),
    todo_status: TaskStatusSchema.nullable().optional(),
    graph_revision: z.number().int().nonnegative().optional(),
    newly_ready_tasks: z.array(ReviewReadyTaskSchema).optional(),
    adopted: z.boolean().optional(),
    attempt: z.number().int().positive().optional(),
  })
  .passthrough();
export const ReviewItemResponseSchema = z.object({
  id: z.string(),
  project_id: z.string().nullable(),
  project_title: z.string().nullable(),
  subject_type: ReviewSubjectTypeSchema,
  subject_id: z.string(),
  subject_title: z.string().nullable(),
  subject_description: z.string().nullable(),
  subject_href: z.string().nullable(),
  status: ReviewStatusSchema,
  summary: z.string(),
  risk_level: ReviewRiskLevelSchema,
  requested_at: z.string(),
  reviewed_at: z.string().nullable(),
  review_note: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export const ReviewDecisionResponseSchema = z.object({
  review: ReviewItemResponseSchema,
  outcome: z.record(z.string(), z.unknown()),
});

export const ArtifactTypeSchema = z.enum([
  'project_brief',
  'requirements',
  'acceptance_criteria',
  'research_note',
  'decision',
  'report',
  'code_diff',
  'generated_file',
  'external_link',
]);
export const ArtifactResponseSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  task_id: z.string().nullable(),
  type: ArtifactTypeSchema,
  title: z.string(),
  content: z.string(),
  current_version: z.number().int().positive(),
  source: z.string(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const ArtifactRevisionResponseSchema = z.object({
  id: z.string(),
  artifact_id: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  source: z.string(),
  created_by: z.string().nullable(),
  status: z.enum(['approved', 'pending', 'changes_requested', 'rejected']),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
});

// -- Task relationships ----------------------------------------------------

export const TaskRelationshipTypeSchema = z.enum(TASK_RELATIONSHIP_TYPES);

export const TaskRelationshipResponseSchema = z.object({
  id: z.string(),
  source_task_id: z.string(),
  target_task_id: z.string(),
  type: TaskRelationshipTypeSchema,
  label: z.string().nullable().optional(),
  created_by: z.string(),
  proposal_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const TaskRelationshipCreateSchema = z
  .object({
    source_task_id: z.string().min(1),
    target_task_id: z.string().min(1),
    type: TaskRelationshipTypeSchema,
    label: z.string().nullable().optional(),
  })
  .strict();

export const TaskRelationshipUpdateSchema = z
  .object({
    source_task_id: z.string().min(1).optional(),
    target_task_id: z.string().min(1).optional(),
    type: TaskRelationshipTypeSchema.optional(),
    label: z.string().nullable().optional(),
  })
  .strict();

export const TaskRelationshipListResponseSchema = z
  .union([
    z.array(TaskRelationshipResponseSchema),
    z.object({ items: z.array(TaskRelationshipResponseSchema) }),
  ])
  .transform((response) => (Array.isArray(response) ? response : response.items));

export const TaskDependencyCommandRequestSchema = z
  .object({
    dependent_task_id: z.string().min(1),
    prerequisite_task_id: z.string().min(1),
    expected_graph_revision: z.number().int().nonnegative(),
  })
  .strict();

export const TaskDependencyInsightsDeltaSchema = z.object({
  ready_count: z.number().int(),
  blocked_count: z.number().int(),
  critical_path_minutes: z.number().int().nullable(),
});

export const TaskDependencyPreviewResponseSchema = z.object({
  dependent_task_id: z.string(),
  prerequisite_task_id: z.string(),
  base_graph_revision: z.number().int().nonnegative(),
  affected_task_ids: z.array(z.string()),
  insights_delta: TaskDependencyInsightsDeltaSchema.nullable().optional(),
});

export const TaskDependencyCommandResponseSchema = TaskDependencyPreviewResponseSchema.extend({
  relationship: TaskRelationshipResponseSchema,
  graph_revision: z.number().int().nonnegative(),
});

// -- Task graph execution insights -----------------------------------------

export const GraphInsightScopeRoleSchema = z.enum(['root', 'descendant', 'context', 'global']);

export const GraphExecutionStateSchema = z.enum([
  'ready',
  'blocked',
  'in_progress',
  'completed',
  'cancelled',
  'pending',
]);

export const GraphDueRiskSchema = z.enum([
  'none',
  'overdue',
  'blocked',
  'insufficient_time',
  'unknown_estimate',
]);

export const TaskGraphInsightNodeSchema = z.object({
  task_id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  parent_id: z.string().nullable(),
  scope_role: GraphInsightScopeRoleSchema,
  execution_state: GraphExecutionStateSchema,
  estimated_minutes: z.number().int().nullable(),
  due_date: z.string().nullable(),
  dependency_ids: z.array(z.string()),
  direct_blocker_ids: z.array(z.string()),
  transitive_blocker_ids: z.array(z.string()),
  transitive_blocker_count: z.number().int().nonnegative(),
  transitive_blockers_truncated: z.boolean(),
  downstream_task_ids: z.array(z.string()),
  downstream_count: z.number().int().nonnegative(),
  downstream_truncated: z.boolean(),
  is_ready: z.boolean(),
  is_blocked: z.boolean(),
  is_unschedulable: z.boolean(),
  is_on_critical_path: z.boolean(),
  remaining_path_minutes: z.number().int().nonnegative().nullable(),
  remaining_path_known_minutes: z.number().int().nonnegative(),
  estimate_complete: z.boolean(),
  is_container: z.boolean(),
  due_slack_minutes: z.number().int().nullable(),
  due_risk: GraphDueRiskSchema,
});

export const TaskGraphInsightSummarySchema = z.object({
  active_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  in_progress_count: z.number().int().nonnegative(),
  completed_count: z.number().int().nonnegative(),
  cancelled_count: z.number().int().nonnegative(),
  ready_count: z.number().int().nonnegative(),
  blocked_count: z.number().int().nonnegative(),
  at_risk_count: z.number().int().nonnegative(),
  overdue_count: z.number().int().nonnegative(),
  orphan_count: z.number().int().nonnegative(),
  critical_path_task_ids: z.array(z.string()),
  critical_path_minutes: z.number().int().nonnegative().nullable(),
  critical_path_known_minutes: z.number().int().nonnegative(),
  critical_path_estimate_complete: z.boolean(),
  unknown_estimate_task_ids: z.array(z.string()),
  unschedulable_task_ids: z.array(z.string()),
  unschedulable_count: z.number().int().nonnegative(),
  cycle_count: z.number().int().nonnegative(),
  parent_cycle_count: z.number().int().nonnegative(),
  missing_dependency_count: z.number().int().nonnegative(),
  missing_parent_count: z.number().int().nonnegative(),
  due_date_conflict_count: z.number().int().nonnegative(),
  unknown_estimate_count: z.number().int().nonnegative(),
  invalid_estimate_count: z.number().int().nonnegative(),
  cancelled_prerequisite_count: z.number().int().nonnegative(),
  isolated_count: z.number().int().nonnegative(),
  issue_count: z.number().int().nonnegative(),
  is_healthy: z.boolean(),
});

export const TaskGraphInsightIssueSchema = z.object({
  code: z.enum([
    'dependency_cycle',
    'self_dependency',
    'duplicate_dependency',
    'missing_dependency',
    'parent_cycle',
    'missing_parent',
    'due_date_conflict',
    'cancelled_prerequisite',
    'invalid_estimate',
    'lifecycle_conflict',
  ]),
  severity: z.enum(['info', 'warning', 'error']),
  task_ids: z.array(z.string()),
  related_task_ids: z.array(z.string()),
  message: z.string(),
});

export const TaskGraphInsightsResponseSchema = z.object({
  graph_revision: z.number().int().nonnegative(),
  generated_at: z.string(),
  scope: z.object({
    root_task_id: z.string().nullable(),
    task_count: z.number().int().nonnegative(),
    primary_task_count: z.number().int().nonnegative(),
    relationship_count: z.number().int().nonnegative(),
    prerequisite_task_count: z.number().int().nonnegative(),
  }),
  nodes: z.array(TaskGraphInsightNodeSchema),
  summary: TaskGraphInsightSummarySchema,
  issues: z.array(TaskGraphInsightIssueSchema),
  issues_truncated: z.boolean(),
});

// -- Events -----------------------------------------------------------------

export const EventResponseSchema = z.object({
  id: z.string(),
  project_id: z.string().nullable().optional(),
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
  project_id: z.string().nullable().optional(),
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
  project_id: z.string().nullable().optional(),
  description: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  location: z.string().optional(),
  is_all_day: z.boolean().optional(),
  reminder_minutes: z.number().optional(),
  tags: z.array(z.string()).optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrence_end: z.string().nullable().optional(),
});

// -- Chat -------------------------------------------------------------------

export const ConversationResponseSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  last_message: z.string().nullable().optional(),
  is_archived: z.boolean().optional(),
  project_id: z.string().nullable().optional(),
  project_todo_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ConversationCreateSchema = z.object({
  title: z.string().optional(),
  project_id: z.string().optional(),
  project_todo_id: z.string().optional(),
});

export const MessageResponseSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  intent: z.string().optional(),
  message_type: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string(),
});

export const SendMessageRequestSchema = z.object({
  conversation_id: z.string(),
  content: z.string().min(1, 'Message is required'),
  idempotency_key: z.string().nullable().optional(),
});

// -- SSE stream events ------------------------------------------------------

export const StreamEventMetaSchema = z.object({
  conversation_id: z.string(),
  message_id: z.string(),
  user_message_id: z.string().optional(),
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
  needs_review: z.array(TodoResponseSchema).default([]),
  needs_date_tasks: z.array(TodoResponseSchema).default([]),
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
  service: z.literal('clawchat').optional(),
  api_version: z.string().optional(),
  host_id: z.string().optional(),
  host_public_key: z.string().optional(),
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
export type TaskPlacementRequest = z.infer<typeof TaskPlacementRequestSchema>;
export type TaskPlacementResponse = z.infer<typeof TaskPlacementResponseSchema>;
export type TaskBatchPlacementRequest = z.infer<typeof TaskBatchPlacementRequestSchema>;
export type TaskBatchPlacementResponse = z.infer<typeof TaskBatchPlacementResponseSchema>;
export type TaskPlacementGroup = z.infer<typeof TaskPlacementGroupSchema>;
export type TaskGroupedPlacementRequest = z.infer<typeof TaskGroupedPlacementRequestSchema>;
export type InboxTriagePreviewRequest = z.infer<typeof InboxTriagePreviewRequestSchema>;
export type InboxTriageSuggestion = z.infer<typeof InboxTriageSuggestionSchema>;
export type InboxTriageProposedWorkstream = z.infer<typeof InboxTriageProposedWorkstreamSchema>;
export type InboxTriagePreviewResponse = z.infer<typeof InboxTriagePreviewResponseSchema>;
export type ProjectTodoResponse = z.infer<typeof ProjectTodoResponseSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
export type ProjectOverviewResponse = z.infer<typeof ProjectOverviewResponseSchema>;
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type ReviewSubjectType = z.infer<typeof ReviewSubjectTypeSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type ReviewRiskLevel = z.infer<typeof ReviewRiskLevelSchema>;
export type ReviewReadyTask = z.infer<typeof ReviewReadyTaskSchema>;
export type AgentRunApprovalImpact = z.infer<typeof AgentRunApprovalImpactSchema>;
export type AgentRunReviewOutcome = z.infer<typeof AgentRunReviewOutcomeSchema>;
export type ReviewItemResponse = z.infer<typeof ReviewItemResponseSchema>;
export type ReviewDecisionResponse = z.infer<typeof ReviewDecisionResponseSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type ArtifactResponse = z.infer<typeof ArtifactResponseSchema>;
export type ArtifactRevisionResponse = z.infer<typeof ArtifactRevisionResponseSchema>;
export type TaskStatus = GeneratedTaskStatus;
export type TaskRelationshipType = z.infer<typeof TaskRelationshipTypeSchema>;
export type TaskRelationshipResponse = z.infer<typeof TaskRelationshipResponseSchema>;
export type TaskRelationshipCreate = z.infer<typeof TaskRelationshipCreateSchema>;
export type TaskRelationshipUpdate = z.infer<typeof TaskRelationshipUpdateSchema>;
export type TaskDependencyCommandRequest = z.infer<typeof TaskDependencyCommandRequestSchema>;
export type TaskDependencyInsightsDelta = z.infer<typeof TaskDependencyInsightsDeltaSchema>;
export type TaskDependencyPreviewResponse = z.infer<typeof TaskDependencyPreviewResponseSchema>;
export type TaskDependencyCommandResponse = z.infer<typeof TaskDependencyCommandResponseSchema>;
export type GraphInsightScopeRole = z.infer<typeof GraphInsightScopeRoleSchema>;
export type GraphExecutionState = z.infer<typeof GraphExecutionStateSchema>;
export type GraphDueRisk = z.infer<typeof GraphDueRiskSchema>;
export type TaskGraphInsightNode = z.infer<typeof TaskGraphInsightNodeSchema>;
export type TaskGraphInsightSummary = z.infer<typeof TaskGraphInsightSummarySchema>;
export type TaskGraphInsightIssue = z.infer<typeof TaskGraphInsightIssueSchema>;
export type TaskGraphInsightsResponse = z.infer<typeof TaskGraphInsightsResponseSchema>;

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
  status: TaskStatusSchema.optional(),
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
  get sub_tasks() {
    return z.array(AgentTaskResponseSchema).nullable().optional();
  },
});

export const AgentRunStatusSchema = z.enum([
  'queued',
  'starting',
  'running',
  'waiting_input',
  'waiting_review',
  'completed',
  'failed',
  'cancelled',
]);

export const AgentRunResponseSchema = z.object({
  id: z.string(),
  agent_task_id: z.string(),
  project_id: z.string().nullable(),
  project_title: z.string().nullable(),
  todo_id: z.string().nullable(),
  todo_title: z.string().nullable(),
  todo_status: TaskStatusSchema.nullable(),
  task_type: z.string(),
  instruction: z.string(),
  instruction_snapshot: z.string(),
  attempt: z.number().int().positive(),
  provider: z.string(),
  model: z.string().nullable(),
  host_id: z.string().nullable(),
  workspace_id: z.string().nullable(),
  external_run_id: z.string().nullable(),
  status: AgentRunStatusSchema,
  progress: z.number().int().min(0).max(100),
  progress_message: z.string().nullable(),
  result_summary: z.string().nullable(),
  error: z.string().nullable(),
  usage: z.record(z.string(), z.unknown()).nullable(),
  is_adopted: z.boolean(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  heartbeat_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  cancel_requested_at: z.string().nullable(),
  updated_at: z.string(),
});

export const AgentRunEventResponseSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  sequence: z.number().int().positive(),
  event_type: z.string(),
  message: z.string().nullable(),
  progress: z.number().int().min(0).max(100).nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export const AgentRunRecoveryResponseSchema = z.object({
  run_id: z.string(),
  todo_id: z.string(),
  todo_status: TaskStatusSchema,
  graph_revision: z.number().int().nonnegative(),
  execution_state: GraphExecutionStateSchema,
  is_ready: z.boolean(),
  direct_blocker_ids: z.array(z.string()),
});

export const TaskExecutionTelemetryResponseSchema = z.object({
  task_id: z.string(),
  latest_run_id: z.string().nullable(),
  latest_run_status: AgentRunStatusSchema.nullable(),
  latest_run_progress: z.number().int().min(0).max(100).nullable(),
  latest_run_provider: z.string().nullable(),
  latest_run_progress_message: z.string().nullable(),
  latest_run_updated_at: z.string().nullable(),
  pending_review_count: z.number().int().nonnegative(),
  artifact_count: z.number().int().nonnegative(),
  latest_artifact_id: z.string().nullable(),
  latest_artifact_title: z.string().nullable(),
  latest_artifact_type: ArtifactTypeSchema.nullable(),
  latest_artifact_updated_at: z.string().nullable(),
});

export const ExecutionProviderStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  available: z.boolean(),
  connected: z.boolean(),
  host: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  providers: z.array(z.record(z.string(), z.unknown())).default([]),
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

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date');

export const PlanProposalStatusSchema = z.enum([
  'generating',
  'draft',
  'applying',
  'applied',
  'rejected',
  'stale',
  'reverted',
  'failed',
]);

export const PlanChangeSetStatusSchema = z.enum(['applying', 'applied', 'reverted', 'failed']);
export const PlanVaultSyncStatusSchema = z.enum(['pending', 'processing', 'succeeded', 'failed']);

export const PlanSubtaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(10_000).nullable().optional(),
    estimated_minutes: z.number().int().min(1).max(10_080).nullable().optional(),
    due_date: IsoDateSchema.nullable().optional(),
    priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional(),
    depends_on_indices: z.array(z.number().int().min(0).max(49)).max(50).optional(),
  })
  .strict();

export const PlanValidationIssueSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    path: z.string().nullable().optional(),
  })
  .strict();

export const PlanValidationResultSchema = z
  .object({
    errors: z.array(PlanValidationIssueSchema),
    warnings: z.array(PlanValidationIssueSchema),
  })
  .strict();

export const PlanProposalDiffSchema = z
  .object({
    add_task_count: z.number().int().nonnegative(),
    add_relationship_count: z.number().int().nonnegative(),
    root_update_fields: z.array(z.string()),
  })
  .strict();

export const PlanProposalResponseSchema = z.object({
  proposal_id: z.string().min(1),
  task_id: z.string().min(1),
  agent_task_id: z.string().nullable(),
  todo_id: z.string().min(1),
  base_graph_revision: z.number().int().nonnegative().nullable(),
  status: PlanProposalStatusSchema,
  validation: PlanValidationResultSchema,
  diff: PlanProposalDiffSchema,
  summary: z.string(),
  suggested_root_due_date: IsoDateSchema.nullable(),
  suggested_assignee: z.string().nullable(),
  suggested_skills: z.array(z.string()).nullable(),
  suggested_project_title: z.string().nullable(),
  subtasks: z.array(PlanSubtaskSchema),
  subtask_count: z.number().int().nonnegative(),
  suggested_due_summary: z.string().nullable(),
  suggested_assignee_label: z.string().nullable(),
  suggested_skills_labels: z.array(z.string()).nullable(),
  suggested_project_label: z.string().nullable(),
  created_at: z.string(),
});

// Backward-compatible name used by existing graph planning imports.
export const PlanResponseSchema = PlanProposalResponseSchema;

export const PlanGenerateRequestSchema = z
  .object({ instructions: z.string().max(2000).nullable().optional() })
  .strict();

export const PlanApplyRequestSchema = z
  .object({
    proposal_id: z.string().trim().min(1).max(128),
    base_graph_revision: z.number().int().nonnegative(),
    selected_indices: z
      .array(z.number().int().min(0).max(49))
      .min(1)
      .max(50)
      .refine((indices) => new Set(indices).size === indices.length, 'Duplicate selection')
      .optional(),
    subtasks: z.array(PlanSubtaskSchema).max(50).optional(),
  })
  .strict();

export const PlanDismissRequestSchema = z
  .object({ proposal_id: z.string().trim().min(1).max(128) })
  .strict();

export const PlanDismissResponseSchema = z.object({
  status: z.literal('rejected'),
  todo_id: z.string(),
  proposal_id: z.string(),
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

export const DelegateResponseSchema = z.object({
  status: z.literal('delegated'),
  task_id: z.string(),
  todo_id: z.string(),
  agent_task_id: z.string(),
  run_id: z.string(),
  skill_id: z.string(),
  skill_chain: z.array(z.string()),
  agent_type: z.string(),
});

export const PlanApplyResponseSchema = z.object({
  todo_id: z.string(),
  proposal_id: z.string(),
  change_set_id: z.string(),
  applied_graph_revision: z.number().int().nonnegative(),
  created_subtask_ids: z.array(z.string()),
  created_relationships: z.number().int().nonnegative(),
  root_update_fields: z.array(z.string()),
  project_folder_created: z.string().nullable(),
  already_applied: z.boolean(),
  can_undo: z.boolean(),
  vault_sync_status: PlanVaultSyncStatusSchema,
});

export const PlanUndoResponseSchema = z.object({
  change_set_id: z.string(),
  proposal_id: z.string(),
  todo_id: z.string(),
  reverted_graph_revision: z.number().int().nonnegative(),
  reverted_subtask_ids: z.array(z.string()),
  already_reverted: z.boolean(),
  vault_sync_status: PlanVaultSyncStatusSchema,
});

export const StalePlanProposalDetailsSchema = z.object({
  base_revision: z.number().int().nonnegative().nullable(),
  current_revision: z.number().int().nonnegative(),
});

export const PlanProposalErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
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
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;
export type AgentRunResponse = z.infer<typeof AgentRunResponseSchema>;
export type AgentRunEventResponse = z.infer<typeof AgentRunEventResponseSchema>;
export type AgentRunRecoveryResponse = z.infer<typeof AgentRunRecoveryResponseSchema>;
export type TaskExecutionTelemetryResponse = z.infer<typeof TaskExecutionTelemetryResponseSchema>;
export type ExecutionProviderStatus = z.infer<typeof ExecutionProviderStatusSchema>;
export type PlanSubtask = z.infer<typeof PlanSubtaskSchema>;
export type PlanProposalStatus = z.infer<typeof PlanProposalStatusSchema>;
export type PlanChangeSetStatus = z.infer<typeof PlanChangeSetStatusSchema>;
export type PlanVaultSyncStatus = z.infer<typeof PlanVaultSyncStatusSchema>;
export type PlanValidationIssue = z.infer<typeof PlanValidationIssueSchema>;
export type PlanValidationResult = z.infer<typeof PlanValidationResultSchema>;
export type PlanProposalDiff = z.infer<typeof PlanProposalDiffSchema>;
export type PlanProposalResponse = z.infer<typeof PlanProposalResponseSchema>;
export type PlanResponse = z.infer<typeof PlanResponseSchema>;
export type PlanGenerateRequest = z.infer<typeof PlanGenerateRequestSchema>;
export type PlanApplyRequest = z.infer<typeof PlanApplyRequestSchema>;
export type PlanDismissRequest = z.infer<typeof PlanDismissRequestSchema>;
export type PlanDismissResponse = z.infer<typeof PlanDismissResponseSchema>;
export type PlanApplyResponse = z.infer<typeof PlanApplyResponseSchema>;
export type PlanUndoResponse = z.infer<typeof PlanUndoResponseSchema>;
export type StalePlanProposalDetails = z.infer<typeof StalePlanProposalDetailsSchema>;
export type PlanProposalErrorResponse = z.infer<typeof PlanProposalErrorResponseSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SkillsResponse = z.infer<typeof SkillsResponseSchema>;
export type DelegateResponse = z.infer<typeof DelegateResponseSchema>;

// ---------------------------------------------------------------------------
// Obsidian vault integration
// ---------------------------------------------------------------------------

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
  queue_pending: z.number().optional(),
  queue_age_seconds: z.number().nullable().optional(),
  dead_letter_count: z.number().optional(),
  last_cli_error: z
    .object({
      timestamp: z.number(),
      command: z.string(),
      error: z.string(),
      returncode: z.number().nullable(),
    })
    .nullable()
    .optional(),
  last_successful_cli_at: z.number().nullable().optional(),
  scan_stuck: z.boolean().optional(),
  write_queue: z.object({
    pending: z.number(),
    oldest_age_seconds: z.number().nullable().optional(),
    operations: z.array(
      z.object({
        op: z.string(),
        path: z.string(),
        queued_at: z.number(),
        retries: z.number(),
        error: z.string().nullable(),
      }),
    ),
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

export const ObsidianScanResultSchema = z.object({
  files_scanned: z.number(),
  markers_found: z.number(),
  changes_detected: z.number(),
  changes_applied: z.number(),
  errors: z.number(),
  duration_ms: z.number(),
});

export type ObsidianHealth = z.infer<typeof ObsidianHealthSchema>;
export type ObsidianScanResult = z.infer<typeof ObsidianScanResultSchema>;
