import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import type { ProjectResponse, Skill, TodoResponse } from '../../types/api';
import { DelegateResponseSchema, SkillsResponseSchema } from '../../types/schemas';
import { invalidateTaskDerivedQueries } from './invalidateTaskDerivedQueries';
import { queryKeys } from './queryKeys';
import { translateUi } from '../../i18n';
import { useTodosQuery } from './useModuleQueries';
import { useProjectsQuery } from './useChatQueries';
export interface StartReadyTaskExecutionVariables {
  todoId: string;
  skillId: string;
  executionProvider: string;
  model?: string | null;
}

export function resolveExecutionSkillId(
  task: Pick<TodoResponse, 'enabled_skills'>,
  skills: Skill[],
): string | null {
  const executableSkills = skills.filter((skill) => skill.id !== 'plan');
  return (
    task.enabled_skills?.find((id) => executableSkills.some((skill) => skill.id === id)) ??
    executableSkills[0]?.id ??
    null
  );
}

function executionProject(
  task: Pick<TodoResponse, 'project_id'>,
  projects: ProjectResponse[],
  fallbackProjectId?: string | null,
) {
  const projectId = task.project_id ?? fallbackProjectId;
  return projects.find((project) => project.id === projectId) ?? null;
}
export function useSkillsQuery(enabled = true) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.skills,
    queryFn: async () => {
      const response = await apiClient.get('/todos/skills/list');
      return SkillsResponseSchema.parse(response.data);
    },
    enabled: !!serverUrl && enabled,
    staleTime: 5 * 60000,
  });
}
function executionErrorMessage(error: unknown): string {
  const response = error as {
    response?: {
      data?: {
        error?: {
          code?: string;
          message?: string;
        };
      };
    };
  };
  const code = response.response?.data?.error?.code;
  if (code === 'TASK_NOT_READY') return 'This task is no longer Ready. Refresh its blockers.';
  if (code === 'TASK_EXECUTION_ACTIVE') return 'This task already has an active agent run.';
  if (code === 'TASK_EXECUTION_CONFLICT') return 'The task changed before execution started.';
  return response.response?.data?.error?.message ?? 'Could not start the agent run.';
}
export function useStartReadyTaskExecution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      todoId,
      skillId,
      executionProvider,
      model,
    }: StartReadyTaskExecutionVariables) => {
      const response = await apiClient.post(`/todos/${todoId}/delegate`, {
        skill_id: skillId,
        execution_provider: executionProvider,
        model: model || null,
        require_ready: true,
        approved: true,
      });
      return DelegateResponseSchema.parse(response.data);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.todos }),
        queryClient.invalidateQueries({ queryKey: queryKeys.runs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        invalidateTaskDerivedQueries(queryClient),
      ]);
      useToastStore.getState().addToast('success', translateUi('Agent run started'));
    },
    onError: (error) => {
      useToastStore.getState().addToast('error', executionErrorMessage(error));
    },
  });
}

/** Start exactly one Ready task with its Project defaults after an explicit click. */
export function useRunReadyTaskWithProjectDefaults(enabled = true) {
  const todosQuery = useTodosQuery(enabled);
  const projectsQuery = useProjectsQuery(enabled);
  const skillsQuery = useSkillsQuery(enabled);
  const startExecution = useStartReadyTaskExecution();

  const configurationFor = (todoId: string, fallbackProjectId?: string | null) => {
    const task = todosQuery.data?.find((todo) => todo.id === todoId);
    if (!task) return null;
    const project = executionProject(task, projectsQuery.data ?? [], fallbackProjectId);
    if (!project) return null;
    const skillId = resolveExecutionSkillId(task, skillsQuery.data?.skills ?? []);
    if (!skillId) return null;
    return { task, project, skillId };
  };

  const runTask = async (todoId: string, fallbackProjectId?: string | null) => {
    const configuration = configurationFor(todoId, fallbackProjectId);
    if (!configuration) {
      useToastStore
        .getState()
        .addToast('warning', translateUi('The next Ready task is still loading.'));
      return null;
    }
    try {
      return await startExecution.mutateAsync({
        todoId,
        skillId: configuration.skillId,
        executionProvider: configuration.project.default_execution_provider || 'builtin',
        model: configuration.project.default_execution_model,
      });
    } catch {
      // The underlying mutation presents the server's actionable error.
      return null;
    }
  };

  return {
    runTask,
    canRunTask: (todoId: string, fallbackProjectId?: string | null) =>
      Boolean(configurationFor(todoId, fallbackProjectId)),
    isPending: startExecution.isPending,
    isPreparing:
      enabled && (todosQuery.isLoading || projectsQuery.isLoading || skillsQuery.isLoading),
  };
}
