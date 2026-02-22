import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useModuleStore } from '../../stores/useModuleStore';
import {
  TodoResponseSchema,
  EventResponseSchema,
  MemoResponseSchema,
  TaskRelationshipResponseSchema,
  AttachmentResponseSchema,
} from '../../types/schemas';
import type { TodoCreate, TodoUpdate, EventCreate, EventUpdate, MemoCreate, MemoUpdate, KanbanStatus, TaskRelationshipCreate, BulkTodoUpdate } from '../../types/api';
import { queryKeys } from './queryKeys';

// ---------------------------------------------------------------------------
// Query hooks — fetch + validate + sync to Zustand
// ---------------------------------------------------------------------------

export function useTodosQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const query = useQuery({
    queryKey: queryKeys.todos,
    queryFn: async () => {
      const res = await apiClient.get('/todos');
      const raw = res.data?.items ?? res.data ?? [];
      return z.array(TodoResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });

  useEffect(() => {
    if (query.data) {
      useModuleStore.getState().setTodos(query.data);
      useModuleStore.getState().setKanbanStatuses({});
    }
  }, [query.data]);

  return query;
}

export function useEventsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const query = useQuery({
    queryKey: queryKeys.events,
    queryFn: async () => {
      const res = await apiClient.get('/events');
      const raw = res.data?.items ?? res.data ?? [];
      return z.array(EventResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });

  useEffect(() => {
    if (query.data) {
      useModuleStore.getState().setEvents(query.data);
    }
  }, [query.data]);

  return query;
}

export function useMemosQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const query = useQuery({
    queryKey: queryKeys.memos,
    queryFn: async () => {
      const res = await apiClient.get('/memos');
      const raw = res.data?.items ?? res.data ?? [];
      return z.array(MemoResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });

  useEffect(() => {
    if (query.data) {
      useModuleStore.getState().setMemos(query.data);
    }
  }, [query.data]);

  return query;
}

// ---------------------------------------------------------------------------
// Mutation hooks — delegate to store actions + invalidate queries
// ---------------------------------------------------------------------------

export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TodoCreate) => useModuleStore.getState().createTodo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TodoUpdate }) =>
      useModuleStore.getState().serverUpdateTodo(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => useModuleStore.getState().deleteTodo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useToggleTodoComplete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => useModuleStore.getState().toggleTodoComplete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useSetKanbanStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: KanbanStatus }) => {
      useModuleStore.getState().setKanbanStatus(id, status);
      return Promise.resolve();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
    },
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: EventCreate) => useModuleStore.getState().createEvent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: EventUpdate }) =>
      useModuleStore.getState().serverUpdateEvent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => useModuleStore.getState().deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useCreateMemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: MemoCreate) => useModuleStore.getState().createMemo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memos });
    },
  });
}

export function useUpdateMemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MemoUpdate }) =>
      useModuleStore.getState().serverUpdateMemo(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memos });
    },
  });
}

export function useDeleteMemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => useModuleStore.getState().deleteMemo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memos });
    },
  });
}

// ---------------------------------------------------------------------------
// Task Relationships
// ---------------------------------------------------------------------------

export function useTaskRelationshipsQuery(todoId: string) {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery({
    queryKey: queryKeys.taskRelationships(todoId),
    queryFn: async () => {
      const res = await apiClient.get('/task-relationships', { params: { todo_id: todoId } });
      return z.array(TaskRelationshipResponseSchema).parse(res.data);
    },
    enabled: !!serverUrl && !!todoId,
  });
}

export function useCreateTaskRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: TaskRelationshipCreate) => {
      const res = await apiClient.post('/task-relationships', data);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships(variables.source_todo_id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships(variables.target_todo_id) });
    },
  });
}

export function useDeleteTaskRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, sourceTodoId, targetTodoId }: { id: string; sourceTodoId: string; targetTodoId: string }) => {
      await apiClient.delete(`/task-relationships/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships(variables.sourceTodoId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships(variables.targetTodoId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export function useAttachmentsQuery(ownerId: string, ownerType: 'memo' | 'todo') {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery({
    queryKey: queryKeys.attachments(ownerId),
    queryFn: async () => {
      const params = ownerType === 'memo' ? { memo_id: ownerId } : { todo_id: ownerId };
      const res = await apiClient.get('/attachments', { params });
      return z.array(AttachmentResponseSchema).parse(res.data);
    },
    enabled: !!serverUrl && !!ownerId,
  });
}

export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, memoId, todoId }: { file: File; memoId?: string; todoId?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      const params = new URLSearchParams();
      if (memoId) params.set('memo_id', memoId);
      if (todoId) params.set('todo_id', todoId);
      const res = await apiClient.post(`/attachments?${params.toString()}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: (_data, variables) => {
      if (variables.memoId) queryClient.invalidateQueries({ queryKey: queryKeys.attachments(variables.memoId) });
      if (variables.todoId) queryClient.invalidateQueries({ queryKey: queryKeys.attachments(variables.todoId) });
    },
  });
}

export function useDeleteAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ownerId }: { id: string; ownerId: string }) => {
      await apiClient.delete(`/attachments/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.attachments(variables.ownerId) });
    },
  });
}

export function useBulkUpdateTodos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BulkTodoUpdate) => useModuleStore.getState().bulkUpdateTodos(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
