import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  TodoResponseSchema,
  TodoCreateSchema,
  TodoUpdateSchema,
  EventResponseSchema,
  EventCreateSchema,
  ConversationResponseSchema,
  MessageResponseSchema,
  TokenResponseSchema,
  SearchResponseSchema,
  SearchHitSchema,
  TodayResponseSchema,
  HealthResponseSchema,
  TaskStatusSchema,
  TaskRelationshipCreateSchema,
  TaskRelationshipListResponseSchema,
  TaskRelationshipResponseSchema,
  BulkTodoUpdateSchema,
  BulkTodoResponseSchema,
  AttachmentResponseSchema,
  PlanProposalResponseSchema,
  PlanApplyRequestSchema,
  PlanApplyResponseSchema,
  PlanUndoResponseSchema,
} from '../schemas';

const now = new Date().toISOString();

describe('Zod schemas', () => {
  // -- TodoResponse ---------------------------------------------------------
  describe('TodoResponseSchema', () => {
    const validTodo = {
      id: '1',
      title: 'Test',
      status: 'pending' as const,
      created_at: now,
      updated_at: now,
    };

    it('parses valid todo', () => {
      expect(TodoResponseSchema.parse(validTodo)).toEqual(validTodo);
    });

    it('parses todo with optional fields', () => {
      const full = {
        ...validTodo,
        description: 'desc',
        priority: 'high',
        due_date: now,
        tags: ['a'],
      };
      expect(TodoResponseSchema.parse(full)).toEqual(full);
    });

    it('rejects missing id', () => {
      const { id: _, ...bad } = validTodo;
      expect(() => TodoResponseSchema.parse(bad)).toThrow(ZodError);
    });

    it('rejects invalid status', () => {
      expect(() => TodoResponseSchema.parse({ ...validTodo, status: 'unknown' })).toThrow(ZodError);
    });

    it('rejects invalid priority', () => {
      expect(() => TodoResponseSchema.parse({ ...validTodo, priority: 'extreme' })).toThrow(
        ZodError,
      );
    });
  });

  // -- TodoCreate -----------------------------------------------------------
  describe('TodoCreateSchema', () => {
    it('parses valid create payload', () => {
      expect(TodoCreateSchema.parse({ title: 'Do stuff' })).toEqual({ title: 'Do stuff' });
    });

    it('accepts an explicit canonical status', () => {
      expect(TodoCreateSchema.parse({ title: 'Continue', status: 'in_progress' })).toEqual({
        title: 'Continue',
        status: 'in_progress',
      });
    });

    it('rejects empty title', () => {
      expect(() => TodoCreateSchema.parse({ title: '' })).toThrow(ZodError);
    });

    it('error message says Title is required', () => {
      try {
        TodoCreateSchema.parse({ title: '' });
      } catch (err) {
        const issues = (err as ZodError).issues;
        expect(issues[0].message).toBe('Title is required');
      }
    });
  });

  // -- TodoUpdate -----------------------------------------------------------
  describe('TodoUpdateSchema', () => {
    it('allows partial updates', () => {
      expect(TodoUpdateSchema.parse({ status: 'completed' })).toEqual({ status: 'completed' });
    });

    it('rejects empty title when title is provided', () => {
      expect(() => TodoUpdateSchema.parse({ title: '' })).toThrow(ZodError);
    });
  });

  // -- Task relationships --------------------------------------------------
  describe('TaskRelationship schemas', () => {
    const relationship = {
      id: 'relationship-1',
      source_task_id: 'dependent-task',
      target_task_id: 'prerequisite-task',
      type: 'depends_on' as const,
      label: null,
      created_by: 'user',
      proposal_id: null,
      created_at: now,
      updated_at: now,
    };

    it('parses a normalized relationship response', () => {
      expect(TaskRelationshipResponseSchema.parse(relationship)).toEqual(relationship);
    });

    it('accepts array and paginated-style list response shapes', () => {
      expect(TaskRelationshipListResponseSchema.parse([relationship])).toEqual([relationship]);
      expect(TaskRelationshipListResponseSchema.parse({ items: [relationship] })).toEqual([
        relationship,
      ]);
    });

    it('validates canonical relationship types and create fields', () => {
      expect(
        TaskRelationshipCreateSchema.parse({
          source_task_id: 'dependent-task',
          target_task_id: 'prerequisite-task',
          type: 'depends_on',
        }),
      ).toEqual({
        source_task_id: 'dependent-task',
        target_task_id: 'prerequisite-task',
        type: 'depends_on',
      });
      expect(() =>
        TaskRelationshipCreateSchema.parse({
          source_task_id: 'dependent-task',
          target_task_id: 'prerequisite-task',
          type: 'blocks',
        }),
      ).toThrow(ZodError);
      expect(() =>
        TaskRelationshipCreateSchema.parse({
          source_task_id: 'dependent-task',
          target_task_id: 'prerequisite-task',
          type: 'depends_on',
          created_by: 'ai',
        }),
      ).toThrow(ZodError);
    });
  });

  // -- EventResponse --------------------------------------------------------
  describe('EventResponseSchema', () => {
    const validEvent = {
      id: 'e1',
      title: 'Meeting',
      start_time: now,
      created_at: now,
      updated_at: now,
    };

    it('parses valid event', () => {
      expect(EventResponseSchema.parse(validEvent)).toEqual(validEvent);
    });

    it('rejects missing start_time', () => {
      const { start_time: _, ...bad } = validEvent;
      expect(() => EventResponseSchema.parse(bad)).toThrow(ZodError);
    });
  });

  // -- EventCreate ----------------------------------------------------------
  describe('EventCreateSchema', () => {
    it('rejects empty title', () => {
      expect(() => EventCreateSchema.parse({ title: '', start_time: now })).toThrow(ZodError);
    });

    it('rejects missing start_time', () => {
      expect(() => EventCreateSchema.parse({ title: 'Event' })).toThrow(ZodError);
    });
  });

  // -- ConversationResponse -------------------------------------------------
  describe('ConversationResponseSchema', () => {
    it('parses valid conversation', () => {
      const conv = { id: 'c1', created_at: now, updated_at: now };
      expect(ConversationResponseSchema.parse(conv)).toEqual(conv);
    });
  });

  // -- MessageResponse ------------------------------------------------------
  describe('MessageResponseSchema', () => {
    it('parses valid message', () => {
      const msg = {
        id: 'msg1',
        conversation_id: 'c1',
        role: 'user' as const,
        content: 'hi',
        created_at: now,
      };
      expect(MessageResponseSchema.parse(msg)).toEqual(msg);
    });

    it('rejects invalid role', () => {
      expect(() =>
        MessageResponseSchema.parse({
          id: 'msg1',
          conversation_id: 'c1',
          role: 'system',
          content: 'hi',
          created_at: now,
        }),
      ).toThrow(ZodError);
    });
  });

  // -- TokenResponse --------------------------------------------------------
  describe('TokenResponseSchema', () => {
    it('parses valid token response', () => {
      const data = { access_token: 'abc', refresh_token: 'def', token_type: 'bearer' };
      expect(TokenResponseSchema.parse(data)).toEqual(data);
    });
  });

  // -- SearchResponse -------------------------------------------------------
  describe('SearchResponseSchema', () => {
    it('parses valid paginated search response', () => {
      const data = {
        items: [
          {
            type: 'todo',
            id: '1',
            title: 'Buy milk',
            preview: 'Buy milk from store',
            rank: 1,
            created_at: now,
          },
          {
            type: 'event',
            id: '2',
            title: 'Meeting',
            preview: 'Team standup',
            rank: 2,
            created_at: now,
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
      };
      expect(SearchResponseSchema.parse(data)).toEqual(data);
    });

    it('parses empty paginated search response', () => {
      const data = { items: [], total: 0, page: 1, limit: 20 };
      expect(SearchResponseSchema.parse(data)).toEqual(data);
    });

    it('validates SearchHitSchema fields', () => {
      const hit = {
        type: 'todo',
        id: 't1',
        title: 'Note',
        preview: 'A note...',
        rank: 1,
        created_at: now,
      };
      expect(SearchHitSchema.parse(hit)).toEqual(hit);
    });
  });

  // -- TodayResponse --------------------------------------------------------
  describe('TodayResponseSchema', () => {
    it('parses valid today response', () => {
      const data = {
        today_tasks: [],
        overdue_tasks: [],
        today_events: [],
        needs_review: [],
        needs_date_tasks: [],
        inbox_count: 5,
        greeting: 'Good morning',
        date: '2026-02-22',
      };
      expect(TodayResponseSchema.parse(data)).toEqual(data);
    });

    it('defaults needs_review when the server omits it', () => {
      const parsed = TodayResponseSchema.parse({
        today_tasks: [],
        overdue_tasks: [],
        today_events: [],
        inbox_count: 0,
        greeting: 'Good evening',
        date: '2026-02-22',
      });
      expect(parsed.needs_review).toEqual([]);
    });
  });

  // -- HealthResponse -------------------------------------------------------
  describe('HealthResponseSchema', () => {
    it('parses valid health response', () => {
      const data = {
        status: 'ok' as const,
        version: '1.0.0',
        ai_backend: 'anthropic',
        ai_model: 'claude',
        ai_connected: true,
      };
      expect(HealthResponseSchema.parse(data)).toEqual(data);
    });
  });

  // -- TodoResponse with parent_id and sort_order ----------------------------
  describe('TodoResponseSchema — Phase 3 fields', () => {
    const base = {
      id: '1',
      title: 'Test',
      status: 'pending' as const,
      created_at: now,
      updated_at: now,
    };

    it('parses todo with parent_id string', () => {
      const todo = { ...base, parent_id: 'parent-1' };
      expect(TodoResponseSchema.parse(todo).parent_id).toBe('parent-1');
    });

    it('parses todo with parent_id null', () => {
      const todo = { ...base, parent_id: null };
      expect(TodoResponseSchema.parse(todo).parent_id).toBeNull();
    });

    it('parses todo with parent_id omitted', () => {
      const result = TodoResponseSchema.parse(base);
      expect(result.parent_id).toBeUndefined();
    });

    it('parses todo with sort_order', () => {
      const todo = { ...base, sort_order: 5 };
      expect(TodoResponseSchema.parse(todo).sort_order).toBe(5);
    });

    it('parses todo without sort_order (optional)', () => {
      const result = TodoResponseSchema.parse(base);
      expect(result.sort_order).toBeUndefined();
    });
  });

  // -- BulkTodoUpdateSchema --------------------------------------------------
  describe('BulkTodoUpdateSchema', () => {
    it('parses valid bulk update', () => {
      const data = { ids: ['1', '2'], status: 'completed' as const };
      expect(BulkTodoUpdateSchema.parse(data)).toEqual(data);
    });

    it('rejects empty ids array', () => {
      expect(() => BulkTodoUpdateSchema.parse({ ids: [] })).toThrow(ZodError);
    });

    it('accepts delete flag', () => {
      const data = { ids: ['1'], delete: true };
      expect(BulkTodoUpdateSchema.parse(data).delete).toBe(true);
    });

    it('accepts priority in bulk update', () => {
      const data = { ids: ['1'], priority: 'high' as const };
      expect(BulkTodoUpdateSchema.parse(data).priority).toBe('high');
    });
  });

  // -- BulkTodoResponseSchema ------------------------------------------------
  describe('BulkTodoResponseSchema', () => {
    it('parses valid bulk response', () => {
      const data = { updated: 3, deleted: 0, errors: [] };
      expect(BulkTodoResponseSchema.parse(data)).toEqual(data);
    });

    it('parses response with errors', () => {
      const data = { updated: 1, deleted: 0, errors: ['Todo x not found'] };
      expect(BulkTodoResponseSchema.parse(data).errors).toHaveLength(1);
    });
  });

  // -- AttachmentResponse ---------------------------------------------------
  describe('AttachmentResponseSchema', () => {
    const validAttachment = {
      id: 'att_abc123',
      filename: 'photo.jpg',
      stored_filename: 'abcdef123456.jpg',
      content_type: 'image/jpeg',
      size_bytes: 102400,
      todo_id: null,
      url: '/api/attachments/att_abc123/download',
      created_at: now,
    };

    it('parses valid attachment', () => {
      expect(AttachmentResponseSchema.parse(validAttachment)).toEqual(validAttachment);
    });

    it('rejects missing required fields', () => {
      const { filename: _, ...bad } = validAttachment;
      expect(() => AttachmentResponseSchema.parse(bad)).toThrow(ZodError);
    });

    it('allows nullable todo_id', () => {
      const att = { ...validAttachment, todo_id: null };
      const parsed = AttachmentResponseSchema.parse(att);
      expect(parsed.todo_id).toBeNull();
    });

    it('allows omitted todo_id', () => {
      const { todo_id: _t, ...att } = validAttachment;
      const parsed = AttachmentResponseSchema.parse(att);
      expect(parsed.todo_id).toBeUndefined();
    });
  });

  // -- TaskStatus -----------------------------------------------------------
  describe('TaskStatusSchema', () => {
    it('accepts valid statuses', () => {
      expect(TaskStatusSchema.parse('pending')).toBe('pending');
      expect(TaskStatusSchema.parse('in_progress')).toBe('in_progress');
      expect(TaskStatusSchema.parse('completed')).toBe('completed');
      expect(TaskStatusSchema.parse('cancelled')).toBe('cancelled');
    });

    it('rejects invalid status', () => {
      expect(() => TaskStatusSchema.parse('done')).toThrow(ZodError);
    });
  });

  describe('versioned plan proposal schemas', () => {
    const proposal = {
      proposal_id: 'proposal-1',
      task_id: 'proposal-1',
      agent_task_id: null,
      todo_id: 'todo-1',
      base_graph_revision: 7,
      status: 'draft' as const,
      validation: { errors: [], warnings: [] },
      diff: {
        add_task_count: 2,
        add_relationship_count: 1,
        root_update_fields: ['due_date'],
      },
      summary: 'A safe two-step plan',
      suggested_root_due_date: null,
      suggested_assignee: null,
      suggested_skills: null,
      suggested_project_title: null,
      subtasks: [
        { title: 'Research', depends_on_indices: [] },
        { title: 'Build', depends_on_indices: [0] },
      ],
      subtask_count: 2,
      suggested_due_summary: null,
      suggested_assignee_label: null,
      suggested_skills_labels: null,
      suggested_project_label: null,
      created_at: now,
    };

    it('requires proposal identity, graph revision, diff, and validation', () => {
      expect(PlanProposalResponseSchema.parse(proposal)).toEqual(proposal);
      expect(() => PlanProposalResponseSchema.parse({ ...proposal, diff: undefined })).toThrow(
        ZodError,
      );
      expect(() => PlanProposalResponseSchema.parse({ ...proposal, status: 'dismissed' })).toThrow(
        ZodError,
      );
    });

    it('allows a nullable revision only on legacy proposal responses', () => {
      expect(
        PlanProposalResponseSchema.parse({ ...proposal, base_graph_revision: null })
          .base_graph_revision,
      ).toBeNull();
      expect(() =>
        PlanApplyRequestSchema.parse({
          proposal_id: proposal.proposal_id,
          base_graph_revision: null,
          selected_indices: [0],
        }),
      ).toThrow(ZodError);
    });

    it('validates exact apply and undo result contracts', () => {
      expect(
        PlanApplyResponseSchema.parse({
          todo_id: 'todo-1',
          proposal_id: 'proposal-1',
          change_set_id: 'change-set-1',
          applied_graph_revision: 8,
          created_subtask_ids: ['todo-2'],
          created_relationships: 1,
          root_update_fields: ['due_date'],
          project_folder_created: null,
          already_applied: false,
          can_undo: true,
          vault_sync_status: 'pending',
        }).change_set_id,
      ).toBe('change-set-1');

      expect(
        PlanUndoResponseSchema.parse({
          change_set_id: 'change-set-1',
          proposal_id: 'proposal-1',
          todo_id: 'todo-1',
          reverted_graph_revision: 9,
          reverted_subtask_ids: ['todo-2'],
          already_reverted: false,
          vault_sync_status: 'processing',
        }).reverted_graph_revision,
      ).toBe(9);
    });
  });
});
