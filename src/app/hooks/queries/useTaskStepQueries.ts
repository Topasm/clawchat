import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { TaskStepResponseSchema, TodoPathResponseSchema } from '../../types/schemas';
import type {
  TaskStepResponse,
  TodoPathKind,
  TodoPathResponse,
  TodoResponse,
} from '../../types/api';
import { translateUi } from '../../i18n';
import { queryKeys } from './queryKeys';
import { invalidateTaskDerivedQueries } from './invalidateTaskDerivedQueries';

function refreshFlow(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.todos });
  void queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
  void queryClient.invalidateQueries({ queryKey: queryKeys.today });
  void invalidateTaskDerivedQueries(queryClient);
}

function useUndoTaskStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (changeId: string) => {
      await apiClient.post(`/todos/step-changes/${changeId}/undo`);
    },
    onError: () => useToastStore.getState().addToast('error', translateUi('Could not undo')),
    onSettled: () => refreshFlow(queryClient),
  });
}

function offerUndo(message: string, undo: () => void) {
  useToastStore.getState().addToast('success', message, {
    duration: 5000,
    action: { label: translateUi('Undo'), onClick: undo },
  });
}

/**
 * Add a step under a task. Without `branchFromId` it goes after the flow's
 * current end; with it, it forks from the same place as that step.
 */
export function useAddTaskStep() {
  const queryClient = useQueryClient();
  const undo = useUndoTaskStep();
  return useMutation({
    mutationFn: async ({
      parentId,
      title,
      branchFromId,
    }: {
      parentId: string;
      title: string;
      branchFromId?: string | null;
    }): Promise<TaskStepResponse> => {
      const response = await apiClient.post(`/todos/${parentId}/steps`, {
        title,
        branch_from_id: branchFromId ?? null,
      });
      return TaskStepResponseSchema.parse(response.data);
    },
    onMutate: async ({ parentId, title }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos });
      const now = new Date().toISOString();
      const optimistic: TodoResponse = {
        id: `temp-step-${Date.now()}`,
        title,
        status: 'pending',
        tags: [],
        parent_id: parentId,
        inbox_state: 'none',
        sort_order: Number.MAX_SAFE_INTEGER,
        created_at: now,
        updated_at: now,
      };
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) => [
        ...(old ?? []),
        optimistic,
      ]);
      return { optimisticId: optimistic.id };
    },
    onSuccess: (result, _variables, context) => {
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).map((todo) => (todo.id === context?.optimisticId ? result.todo : todo)),
      );
      offerUndo(translateUi('Step added'), () => undo.mutate(result.change_id));
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).filter((todo) => todo.id !== context?.optimisticId),
      );
      useToastStore.getState().addToast('error', translateUi('Could not add the step'));
    },
    onSettled: () => refreshFlow(queryClient),
  });
}

/** Move a step to right after another (or to the start when `afterId` is null). */
export function useMoveTaskStep() {
  const queryClient = useQueryClient();
  const undo = useUndoTaskStep();
  return useMutation({
    mutationFn: async ({
      parentId,
      stepId,
      afterId,
    }: {
      parentId: string;
      stepId: string;
      afterId: string | null;
    }): Promise<TaskStepResponse> => {
      const response = await apiClient.post(`/todos/${parentId}/steps/move`, {
        step_id: stepId,
        after_id: afterId,
      });
      return TaskStepResponseSchema.parse(response.data);
    },
    onSuccess: (result) =>
      offerUndo(translateUi('Step moved'), () => undo.mutate(result.change_id)),
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not move the step')),
    onSettled: () => refreshFlow(queryClient),
  });
}

export function useTodoPathsQuery(todoId: string | undefined) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.todoPaths(todoId ?? ''),
    queryFn: async () => {
      const response = await apiClient.get(`/todos/${todoId}/paths`);
      return z.array(TodoPathResponseSchema).parse(response.data);
    },
    enabled: Boolean(serverUrl && todoId),
  });
}

export interface TodoPathInput {
  kind: TodoPathKind;
  path: string;
  host_id?: string | null;
  label?: string | null;
}

export function useAddTodoPath(todoId: string) {
  const queryClient = useQueryClient();
  const remove = useDeleteTodoPath(todoId, { offerUndo: false });
  return useMutation({
    mutationFn: async (input: TodoPathInput): Promise<TodoPathResponse> => {
      const response = await apiClient.post(`/todos/${todoId}/paths`, input);
      return TodoPathResponseSchema.parse(response.data);
    },
    onSuccess: (path) => offerUndo(translateUi('Path added'), () => remove.mutate(path)),
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not add the path')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todo-paths'] }),
  });
}

export function useDeleteTodoPath(todoId: string, { offerUndo: withUndo = true } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: TodoPathResponse) => {
      await apiClient.delete(`/todos/${todoId}/paths/${path.id}`);
      return path;
    },
    onSuccess: (path) => {
      if (!withUndo) return;
      // Putting it back is adding it again; the new row gets a new id.
      offerUndo(translateUi('Path removed'), () => {
        void apiClient
          .post(`/todos/${todoId}/paths`, {
            kind: path.kind,
            path: path.path,
            host_id: path.host_id ?? null,
            label: path.label ?? null,
          })
          .finally(() => queryClient.invalidateQueries({ queryKey: ['todo-paths'] }));
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todo-paths'] }),
  });
}
