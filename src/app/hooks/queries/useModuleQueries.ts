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
} from '../../types/schemas';
import type { TodoResponse, TodoCreate, TodoUpdate, EventResponse, EventCreate, EventUpdate, KanbanStatus, BulkTodoUpdate } from '../../types/api';
import { queryKeys } from './queryKeys';

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
        status: 'pending',
        priority: newTodo.priority,
        due_date: newTodo.due_date,
        tags: newTodo.tags ?? [],
        parent_id: newTodo.parent_id ?? null,
        description: newTodo.description,
        source: newTodo.source,
        inbox_state: newTodo.inbox_state,
        sort_order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) => [optimistic, ...(old ?? [])]);

      return { previous };
    },
    onError: (_err, _newTodo, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.todos, context.previous);
      }
      useToastStore.getState().addToast('error', 'Failed to create task');
    },
    onSuccess: () => {
      useToastStore.getState().addToast('success', 'Task created');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
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
          t.id === id ? { ...t, ...data, updated_at: new Date().toISOString() } as TodoResponse : t,
        ),
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.todos, context.previous);
      }
      useToastStore.getState().addToast('error', 'Failed to update task on server, changes reverted');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
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
          } catch (err) {
            logger.warn('Failed to delete todo on server:', err);
            // Rollback: refetch to restore
            queryClient.invalidateQueries({ queryKey: queryKeys.todos });
            useToastStore.getState().addToast('error', 'Failed to delete task on server');
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
      const savedKanbanStatus = useModuleStore.getState().kanbanStatuses[id];

      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );

      return { previous, deleted, savedKanbanStatus };
    },
    onSuccess: (_data, id, context) => {
      useToastStore.getState().addToast('success', 'Task deleted', {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            // Cancel the pending server delete
            const timer = pendingDeletes.get(id);
            if (timer) {
              clearTimeout(timer);
              pendingDeletes.delete(id);
            }
            // Restore the todo in the cache
            if (context?.deleted) {
              queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) => [context.deleted!, ...(old ?? [])]);
            }
            if (context?.savedKanbanStatus) {
              useModuleStore.setState((state) => ({
                kanbanStatuses: { ...state.kanbanStatuses, [id]: context.savedKanbanStatus! },
              }));
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
    mutationFn: async ({ id, currentStatus }: { id: string; currentStatus: string }) => {
      const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
      await apiClient.patch(`/todos/${id}`, { status: newStatus });
      return newStatus;
    },
    onMutate: async ({ id, currentStatus }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const previous = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);
      const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';

      // Remove kanban override when toggling
      const prevKanbanStatus = useModuleStore.getState().kanbanStatuses[id];
      useModuleStore.setState((state) => {
        const next = { ...state.kanbanStatuses };
        delete next[id];
        return { kanbanStatuses: next };
      });

      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
      );

      useToastStore.getState().addToast(
        'success',
        newStatus === 'completed' ? 'Task completed' : 'Task reopened',
      );

      return { previous, prevKanbanStatus };
    },
    onError: (_err, { id }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.todos, context.previous);
      }
      if (context?.prevKanbanStatus !== undefined) {
        useModuleStore.setState((state) => ({
          kanbanStatuses: { ...state.kanbanStatuses, [id]: context.prevKanbanStatus! },
        }));
      }
      useToastStore.getState().addToast('error', 'Failed to update task on server, change reverted');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useSetKanbanStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: KanbanStatus }) => {
      // Sync to server: in_progress maps to pending on the server
      const serverStatus = status === 'in_progress' ? 'pending' : status;
      const todos = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos) ?? [];
      const todo = todos.find((t) => t.id === id);
      if (todo && todo.status !== serverStatus) {
        await apiClient.patch(`/todos/${id}`, { status: serverStatus });
      }
    },
    onMutate: async ({ id, status }) => {
      const prevKanbanStatus = useModuleStore.getState().kanbanStatuses[id];
      const prevTodos = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos);

      // Optimistic kanban status update
      useModuleStore.setState((state) => ({
        kanbanStatuses: { ...state.kanbanStatuses, [id]: status },
      }));

      // Optimistic todo status update
      const serverStatus = status === 'in_progress' ? 'pending' : status;
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, status: serverStatus } : t)),
      );

      const label = status === 'in_progress' ? 'In Progress' : status === 'completed' ? 'Done' : 'Todo';
      useToastStore.getState().addToast('success', `Task moved to ${label}`);

      return { prevKanbanStatus, prevTodos };
    },
    onError: (_err, { id }, context) => {
      // Rollback kanban status
      if (context?.prevKanbanStatus !== undefined) {
        useModuleStore.setState((state) => ({
          kanbanStatuses: { ...state.kanbanStatuses, [id]: context.prevKanbanStatus! },
        }));
      } else {
        useModuleStore.setState((state) => {
          const next = { ...state.kanbanStatuses };
          delete next[id];
          return { kanbanStatuses: next };
        });
      }
      // Rollback todo data
      if (context?.prevTodos) {
        queryClient.setQueryData(queryKeys.todos, context.prevTodos);
      }
      useToastStore.getState().addToast('error', 'Failed to move task on server, change reverted');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
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
      useToastStore.getState().addToast('error', 'Failed to save reorder on server');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
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
      useToastStore.getState().addToast('success', 'Event created');
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
          e.id === id ? { ...e, ...data, updated_at: new Date().toISOString() } as EventResponse : e,
        ),
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.events, context.previous);
      }
      useToastStore.getState().addToast('error', 'Failed to update event on server, changes reverted');
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
            useToastStore.getState().addToast('error', 'Failed to delete event on server');
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
      useToastStore.getState().addToast('success', 'Event deleted', {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            const timer = pendingDeletes.get(id);
            if (timer) {
              clearTimeout(timer);
              pendingDeletes.delete(id);
            }
            if (context?.deleted) {
              queryClient.setQueryData<EventResponse[]>(queryKeys.events, (old) => [context.deleted!, ...(old ?? [])]);
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
    mutationFn: async ({ eventId, date, mode }: { eventId: string; date: string; mode: string }) => {
      await apiClient.delete(`/events/${eventId}/occurrences/${date}`, { params: { mode } });
    },
    onSuccess: () => {
      useToastStore.getState().addToast('success', 'Occurrence deleted');
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

export function useAttachmentsQuery(ownerId: string, ownerType: 'todo') {
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
    mutationFn: async (data: BulkTodoUpdate) => {
      await apiClient.patch('/todos/bulk', data);
    },
    onSuccess: () => {
      useModuleStore.setState({ selectedTodoIds: new Set<string>() });
      useToastStore.getState().addToast('success', 'Bulk operation completed');
    },
    onError: () => {
      useToastStore.getState().addToast('error', 'Bulk operation failed');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
