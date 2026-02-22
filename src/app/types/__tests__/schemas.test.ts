import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  TodoResponseSchema,
  TodoCreateSchema,
  TodoUpdateSchema,
  EventResponseSchema,
  EventCreateSchema,
  MemoResponseSchema,
  MemoCreateSchema,
  ConversationResponseSchema,
  MessageResponseSchema,
  TokenResponseSchema,
  SearchResponseSchema,
  SearchHitSchema,
  TodayResponseSchema,
  HealthResponseSchema,
  KanbanStatusSchema,
  TaskRelationshipResponseSchema,
  TaskRelationshipCreateSchema,
  BulkTodoUpdateSchema,
  BulkTodoResponseSchema,
  RelationshipTypeSchema,
  AttachmentResponseSchema,
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
      const full = { ...validTodo, description: 'desc', priority: 'high', due_date: now, tags: ['a'] };
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
      expect(() => TodoResponseSchema.parse({ ...validTodo, priority: 'extreme' })).toThrow(ZodError);
    });
  });

  // -- TodoCreate -----------------------------------------------------------
  describe('TodoCreateSchema', () => {
    it('parses valid create payload', () => {
      expect(TodoCreateSchema.parse({ title: 'Do stuff' })).toEqual({ title: 'Do stuff' });
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

  // -- EventResponse --------------------------------------------------------
  describe('EventResponseSchema', () => {
    const validEvent = { id: 'e1', title: 'Meeting', start_time: now, created_at: now, updated_at: now };

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

  // -- MemoResponse ---------------------------------------------------------
  describe('MemoResponseSchema', () => {
    it('parses valid memo', () => {
      const memo = { id: 'm1', title: 'My Memo', content: 'Note', created_at: now, updated_at: now };
      expect(MemoResponseSchema.parse(memo)).toEqual(memo);
    });
  });

  // -- MemoCreate -----------------------------------------------------------
  describe('MemoCreateSchema', () => {
    it('rejects empty content', () => {
      expect(() => MemoCreateSchema.parse({ content: '' })).toThrow(ZodError);
    });

    it('error says Content is required', () => {
      try {
        MemoCreateSchema.parse({ content: '' });
      } catch (err) {
        expect((err as ZodError).issues[0].message).toBe('Content is required');
      }
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
      const msg = { id: 'msg1', conversation_id: 'c1', role: 'user' as const, content: 'hi', created_at: now };
      expect(MessageResponseSchema.parse(msg)).toEqual(msg);
    });

    it('rejects invalid role', () => {
      expect(() =>
        MessageResponseSchema.parse({ id: 'msg1', conversation_id: 'c1', role: 'system', content: 'hi', created_at: now }),
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
          { type: 'todo', id: '1', title: 'Buy milk', preview: 'Buy milk from store', rank: 1, created_at: now },
          { type: 'event', id: '2', title: 'Meeting', preview: 'Team standup', rank: 2, created_at: now },
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
      const hit = { type: 'memo', id: 'm1', title: 'Note', preview: 'A note...', rank: 1, created_at: now };
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
        inbox_count: 5,
        greeting: 'Good morning',
        date: '2026-02-22',
      };
      expect(TodayResponseSchema.parse(data)).toEqual(data);
    });
  });

  // -- HealthResponse -------------------------------------------------------
  describe('HealthResponseSchema', () => {
    it('parses valid health response', () => {
      const data = { status: 'ok' as const, version: '1.0.0', ai_provider: 'anthropic', ai_model: 'claude', ai_connected: true };
      expect(HealthResponseSchema.parse(data)).toEqual(data);
    });
  });

  // -- TodoResponse with parent_id and sort_order ----------------------------
  describe('TodoResponseSchema — Phase 3 fields', () => {
    const base = { id: '1', title: 'Test', status: 'pending' as const, created_at: now, updated_at: now };

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

  // -- TaskRelationshipResponseSchema ----------------------------------------
  describe('TaskRelationshipResponseSchema', () => {
    const validRel = {
      id: 'trel_1',
      source_todo_id: 'todo_a',
      target_todo_id: 'todo_b',
      relationship_type: 'blocks' as const,
      created_at: now,
    };

    it('parses valid relationship', () => {
      expect(TaskRelationshipResponseSchema.parse(validRel)).toEqual(validRel);
    });

    it('rejects invalid relationship_type', () => {
      expect(() =>
        TaskRelationshipResponseSchema.parse({ ...validRel, relationship_type: 'depends_on' }),
      ).toThrow(ZodError);
    });
  });

  // -- TaskRelationshipCreateSchema ------------------------------------------
  describe('TaskRelationshipCreateSchema', () => {
    it('parses valid create', () => {
      const data = { source_todo_id: 'a', target_todo_id: 'b', relationship_type: 'related' as const };
      expect(TaskRelationshipCreateSchema.parse(data)).toEqual(data);
    });

    it('rejects invalid type', () => {
      expect(() =>
        TaskRelationshipCreateSchema.parse({ source_todo_id: 'a', target_todo_id: 'b', relationship_type: 'invalid' }),
      ).toThrow(ZodError);
    });
  });

  // -- RelationshipTypeSchema ------------------------------------------------
  describe('RelationshipTypeSchema', () => {
    it('accepts all valid types', () => {
      expect(RelationshipTypeSchema.parse('blocks')).toBe('blocks');
      expect(RelationshipTypeSchema.parse('blocked_by')).toBe('blocked_by');
      expect(RelationshipTypeSchema.parse('related')).toBe('related');
      expect(RelationshipTypeSchema.parse('duplicate_of')).toBe('duplicate_of');
    });

    it('rejects invalid type', () => {
      expect(() => RelationshipTypeSchema.parse('depends_on')).toThrow(ZodError);
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
      memo_id: 'memo_1',
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

    it('allows nullable memo_id and todo_id', () => {
      const att = { ...validAttachment, memo_id: null, todo_id: null };
      const parsed = AttachmentResponseSchema.parse(att);
      expect(parsed.memo_id).toBeNull();
      expect(parsed.todo_id).toBeNull();
    });

    it('allows omitted memo_id and todo_id', () => {
      const { memo_id: _m, todo_id: _t, ...att } = validAttachment;
      const parsed = AttachmentResponseSchema.parse(att);
      expect(parsed.memo_id).toBeUndefined();
      expect(parsed.todo_id).toBeUndefined();
    });
  });

  // -- KanbanStatus ---------------------------------------------------------
  describe('KanbanStatusSchema', () => {
    it('accepts valid statuses', () => {
      expect(KanbanStatusSchema.parse('pending')).toBe('pending');
      expect(KanbanStatusSchema.parse('in_progress')).toBe('in_progress');
      expect(KanbanStatusSchema.parse('completed')).toBe('completed');
    });

    it('rejects invalid status', () => {
      expect(() => KanbanStatusSchema.parse('done')).toThrow(ZodError);
    });
  });

});
