import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useModuleStore } from '../../stores/useModuleStore';
import { useToastStore } from '../../stores/useToastStore';
import { logger } from '../../services/logger';
import {
  TodoResponseSchema,
  EventResponseSchema,
  AttachmentResponseSchema,
  TaskBatchPlacementResponseSchema,
  InboxTriagePreviewResponseSchema,
  TaskPlacementResponseSchema,
} from '../../types/schemas';
import type {
  TodoResponse,
  TodoCreate,
  TodoUpdate,
  EventResponse,
  EventCreate,
  EventUpdate,
  TaskStatus,
  BulkTodoUpdate,
  TaskBatchPlacementRequest,
  TaskBatchPlacementResponse,
  TaskGroupedPlacementRequest,
  InboxTriagePreviewRequest,
  InboxTriagePreviewResponse,
  TaskPlacementRequest,
  TaskPlacementResponse,
  ProjectResponse,
} from '../../types/api';
import { queryKeys } from './queryKeys';
import { getTaskStatusLabel } from '../../utils/taskStatus';
import { invalidateTaskDerivedQueries } from './invalidateTaskDerivedQueries';
import { translateUi } from '../../i18n';
// ---------------------------------------------------------------------------
// Pending delete timers (for undo-on-delete pattern)
// ---------------------------------------------------------------------------
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();
// ---------------------------------------------------------------------------
// Query hooks — fetch + validate, data lives in TanStack Query cache
// ---------------------------------------------------------------------------
export function useTodosQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.todos,
    queryFn: async () => {
      const res = await apiClient.get('/todos', { params: { limit: 1000 } });
      const raw = res.data?.items ?? res.data ?? [];
      return z.array(TodoResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });
}
export function useEventsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.events,
    queryFn: async () => {
      const res = await apiClient.get('/events');
      const raw = res.data?.items ?? res.data ?? [];
      return z.array(EventResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });
}
// ---------------------------------------------------------------------------
// Mutation hooks — optimistic updates in query cache
// ---------------------------------------------------------------------------
export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: TodoCreate) => {
      const response = await apiClient.post('/todos', data);
      return response.data as TodoResponse;
    },
    onMutate: async (newTodo) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const previous = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);
      // Optimistic insert with temporary ID
      const optimistic: TodoResponse = {
        id: `temp-${Date.now()}`,
        title: newTodo.title,
        status: newTodo.status ?? 'pending',
        priority: newTodo.priority,
        due_date: newTodo.due_date,
        tags: newTodo.tags ?? [],
        parent_id: newTodo.parent_id ?? null,
        project_id: newTodo.project_id ?? null,
        description: newTodo.description,
        source: newTodo.source,
        inbox_state: newTodo.inbox_state,
        sort_order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) => [
        optimistic,
        ...(old ?? []),
      ]);
      return { previous };
    },
    onError: (_err, _newTodo, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.todos, context.previous);
      }
      useToastStore.getState().addToast('error', translateUi('Failed to create task'));
    },
    onSuccess: () => {
      useToastStore.getState().addToast('success', translateUi('Task created'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function useUpdateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TodoUpdate }) => {
      await apiClient.patch(`/todos/${id}`, data);
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const previous = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).map((t) =>
          t.id === id
            ? ({ ...t, ...data, updated_at: new Date().toISOString() } as TodoResponse)
            : t,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.todos, context.previous);
      }
      useToastStore
        .getState()
        .addToast('error', translateUi('Failed to update task on server, changes reverted'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function usePlaceTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      placement,
    }: {
      id: string;
      placement: TaskPlacementRequest;
    }): Promise<TaskPlacementResponse> => {
      const response = await apiClient.post(`/todos/${id}/placement`, placement);
      return TaskPlacementResponseSchema.parse(response.data);
    },
    onMutate: async ({ id, placement }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const previous = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);
      const projects = queryClient.getQueryData<ProjectResponse[]>(queryKeys.projects);
      const effectiveParentId =
        placement.project_id && placement.parent_id === null
          ? (projects?.find((project) => project.id === placement.project_id)?.root_task_id ?? null)
          : placement.parent_id;
      const descendants = new Set<string>([id]);
      let changed = true;
      while (changed) {
        changed = false;
        (previous ?? []).forEach((todo) => {
          if (todo.parent_id && descendants.has(todo.parent_id) && !descendants.has(todo.id)) {
            descendants.add(todo.id);
            changed = true;
          }
        });
      }
      const moved = previous?.find((todo) => todo.id === id);
      const orderUpdates = new Map<string, number>();
      const inScope = (todo: TodoResponse, projectId: string | null, parentId: string | null) =>
        todo.source !== 'project_root' &&
        (todo.project_id ?? null) === projectId &&
        (todo.parent_id ?? null) === parentId;
      const byOrder = (left: TodoResponse, right: TodoResponse) =>
        (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.id.localeCompare(right.id);
      const renumber = (items: TodoResponse[]) =>
        items.forEach((todo, index) => orderUpdates.set(todo.id, index * 10));
      if (moved && previous) {
        const oldScope = [moved.project_id ?? null, moved.parent_id ?? null] as const;
        const newScope = [placement.project_id, effectiveParentId ?? null] as const;
        const sameScope = oldScope[0] === newScope[0] && oldScope[1] === newScope[1];
        if (!sameScope) {
          renumber(
            previous
              .filter((todo) => todo.id !== id && inScope(todo, oldScope[0], oldScope[1]))
              .sort(byOrder),
          );
        }
        const target = previous
          .filter((todo) => todo.id !== id && inScope(todo, newScope[0], newScope[1]))
          .sort(byOrder);
        const beforeIndex = placement.before_id
          ? target.findIndex((todo) => todo.id === placement.before_id)
          : -1;
        target.splice(beforeIndex >= 0 ? beforeIndex : target.length, 0, moved);
        renumber(target);
      }
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (current) =>
        (current ?? []).map((todo) => {
          if (!descendants.has(todo.id) && !orderUpdates.has(todo.id)) return todo;
          return {
            ...todo,
            ...(descendants.has(todo.id) ? { project_id: placement.project_id } : {}),
            ...(orderUpdates.has(todo.id) ? { sort_order: orderUpdates.get(todo.id) } : {}),
            ...(todo.id === id
              ? {
                  parent_id: effectiveParentId,
                  inbox_state:
                    placement.inbox_state ?? (placement.project_id ? 'none' : 'captured'),
                }
              : {}),
          };
        }),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.todos, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function useUndoTodoPlacement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (changeSetId: string): Promise<TaskPlacementResponse> => {
      const response = await apiClient.post(`/todos/placements/${changeSetId}/undo`);
      return TaskPlacementResponseSchema.parse(response.data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function usePlaceTodosBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      placement: TaskBatchPlacementRequest,
    ): Promise<TaskBatchPlacementResponse> => {
      const response = await apiClient.post('/todos/placements/batch', placement);
      return TaskBatchPlacementResponseSchema.parse(response.data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function usePlaceTodoGroups() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      placement: TaskGroupedPlacementRequest,
    ): Promise<TaskBatchPlacementResponse> => {
      const response = await apiClient.post('/todos/placements/groups', placement);
      return TaskBatchPlacementResponseSchema.parse(response.data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function usePreviewInboxTriage() {
  return useMutation({
    mutationFn: async (request: InboxTriagePreviewRequest): Promise<InboxTriagePreviewResponse> => {
      const response = await apiClient.post('/todos/placements/triage-preview', request);
      return InboxTriagePreviewResponseSchema.parse(response.data);
    },
  });
}
export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // The actual server delete is deferred by 5 seconds for undo support.
      // We return a promise that resolves immediately; the server call happens
      // after the undo window.
      return new Promise<void>((resolve) => {
        const timeoutId = setTimeout(async () => {
          pendingDeletes.delete(id);
          try {
            await apiClient.delete(`/todos/${id}`);
            queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
            void invalidateTaskDerivedQueries(queryClient);
          } catch (err) {
            logger.warn('Failed to delete todo on server:', err);
            // Rollback: refetch to restore
            queryClient.invalidateQueries({ queryKey: queryKeys.todos });
            useToastStore
              .getState()
              .addToast('error', translateUi('Failed to delete task on server'));
          }
        }, 5000);
        pendingDeletes.set(id, timeoutId);
        resolve();
      });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const previous = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);
      const deleted = previous?.find((t) => t.id === id);
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { previous, deleted };
    },
    onSuccess: (_data, id, context) => {
      useToastStore.getState().addToast('success', translateUi('Task deleted'), {
        duration: 5000,
        action: {
          label: translateUi('Undo'),
          onClick: () => {
            // Cancel the pending server delete
            const timer = pendingDeletes.get(id);
            if (timer) {
              clearTimeout(timer);
              pendingDeletes.delete(id);
            }
            // Restore the todo in the cache
            if (context?.deleted) {
              queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) => [
                context.deleted!,
                ...(old ?? []),
              ]);
            }
          },
        },
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
export function useToggleTodoComplete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, currentStatus }: { id: string; currentStatus: TaskStatus }) => {
      const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
      await apiClient.patch(`/todos/${id}`, { status: newStatus });
      return newStatus;
    },
    onMutate: async ({ id, currentStatus }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const previous = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);
      const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
      );
      useToastStore
        .getState()
        .addToast(
          'success',
          translateUi(newStatus === 'completed' ? 'Task completed' : 'Task reopened'),
        );
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.todos, context.previous);
      }
      useToastStore
        .getState()
        .addToast('error', translateUi('Failed to update task on server, change reverted'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function useSetTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      await apiClient.patch(`/todos/${id}`, { status });
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const prevTodos = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, status } : t)),
      );
      useToastStore
        .getState()
        .addToast(
          'success',
          translateUi('Task moved to {{status}}', { status: getTaskStatusLabel(status) }),
        );
      return { prevTodos };
    },
    onError: (_err, _variables, context) => {
      if (context?.prevTodos) {
        queryClient.setQueryData(queryKeys.todos, context.prevTodos);
      }
      useToastStore
        .getState()
        .addToast('error', translateUi('Failed to move task on server, change reverted'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function useReorderTodos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ updates }: { updates: Record<string, number> }) => {
      await Promise.all(
        Object.entries(updates).map(([id, order]) =>
          apiClient.patch(`/todos/${id}`, { sort_order: order }),
        ),
      );
    },
    onMutate: async ({ updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const previous = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).map((t) =>
          updates[t.id] !== undefined ? { ...t, sort_order: updates[t.id] } : t,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.todos, context.previous);
      }
      useToastStore.getState().addToast('error', translateUi('Failed to save reorder on server'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: EventCreate) => {
      const response = await apiClient.post('/events', data);
      return response.data as EventResponse;
    },
    onSuccess: () => {
      useToastStore.getState().addToast('success', translateUi('Event created'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EventUpdate }) => {
      await apiClient.patch(`/events/${id}`, data);
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events });
      const previous = queryClient.getQueryData<EventResponse[]>(queryKeys.events);
      queryClient.setQueryData<EventResponse[]>(queryKeys.events, (old) =>
        (old ?? []).map((e) =>
          e.id === id
            ? ({ ...e, ...data, updated_at: new Date().toISOString() } as EventResponse)
            : e,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.events, context.previous);
      }
      useToastStore
        .getState()
        .addToast('error', translateUi('Failed to update event on server, changes reverted'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return new Promise<void>((resolve) => {
        const timeoutId = setTimeout(async () => {
          pendingDeletes.delete(id);
          try {
            await apiClient.delete(`/events/${id}`);
          } catch (err) {
            logger.warn('Failed to delete event on server:', err);
            queryClient.invalidateQueries({ queryKey: queryKeys.events });
            useToastStore
              .getState()
              .addToast('error', translateUi('Failed to delete event on server'));
          }
        }, 5000);
        pendingDeletes.set(id, timeoutId);
        resolve();
      });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events });
      const previous = queryClient.getQueryData<EventResponse[]>(queryKeys.events);
      const deleted = previous?.find((e) => e.id === id);
      queryClient.setQueryData<EventResponse[]>(queryKeys.events, (old) =>
        (old ?? []).filter((e) => e.id !== id),
      );
      return { previous, deleted };
    },
    onSuccess: (_data, id, context) => {
      useToastStore.getState().addToast('success', translateUi('Event deleted'), {
        duration: 5000,
        action: {
          label: translateUi('Undo'),
          onClick: () => {
            const timer = pendingDeletes.get(id);
            if (timer) {
              clearTimeout(timer);
              pendingDeletes.delete(id);
            }
            if (context?.deleted) {
              queryClient.setQueryData<EventResponse[]>(queryKeys.events, (old) => [
                context.deleted!,
                ...(old ?? []),
              ]);
            }
          },
        },
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
export function useDeleteEventOccurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      eventId,
      date,
      mode,
    }: {
      eventId: string;
      date: string;
      mode: string;
    }) => {
      await apiClient.delete(`/events/${eventId}/occurrences/${date}`, { params: { mode } });
    },
    onSuccess: () => {
      useToastStore.getState().addToast('success', translateUi('Occurrence deleted'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
export function useAttachmentsQuery(ownerId: string) {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.attachments(ownerId),
    queryFn: async () => {
      const params = { todo_id: ownerId };
      const res = await apiClient.get('/attachments', { params });
      return z.array(AttachmentResponseSchema).parse(res.data);
    },
    enabled: !!serverUrl && !!ownerId,
  });
}
export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, todoId }: { file: File; todoId?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      const params = new URLSearchParams();
      if (todoId) params.set('todo_id', todoId);
      const res = await apiClient.post(`/attachments?${params.toString()}`, formData);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      if (variables.todoId)
        queryClient.invalidateQueries({ queryKey: queryKeys.attachments(variables.todoId) });
    },
  });
}
export function useDeleteAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; ownerId: string }) => {
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
    mutationFn: async (data: BulkTodoUpdate) => {
      await apiClient.patch('/todos/bulk', data);
    },
    onSuccess: () => {
      useModuleStore.setState({ selectedTodoIds: new Set<string>() });
      useToastStore.getState().addToast('success', translateUi('Bulk operation completed'));
    },
    onError: () => {
      useToastStore.getState().addToast('error', translateUi('Bulk operation failed'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
      void invalidateTaskDerivedQueries(queryClient);
    },
  });
}
