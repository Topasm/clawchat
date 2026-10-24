import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  InboxRoutingListResponseSchema,
  InboxRoutingResponseSchema,
  ProjectFolderCandidateSchema,
  type InboxRouting,
} from '../../types/schemas';
import { queryKeys } from './queryKeys';

/** What the Inbox filed in the last day that the user has not cleared or undone. */
export function useInboxRoutingsQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.inboxRoutings,
    queryFn: async ({ signal }) =>
      InboxRoutingListResponseSchema.parse(
        (await apiClient.get('/inbox/routings', { signal })).data,
      ),
    enabled: !!serverUrl,
  });
}

/** Vault project folders that could become projects. */
export function useInboxProjectCandidatesQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.inboxProjectCandidates,
    queryFn: async ({ signal }) =>
      ProjectFolderCandidateSchema.array().parse(
        (await apiClient.get('/inbox/project-candidates', { signal })).data,
      ),
    enabled: !!serverUrl,
    staleTime: 60_000,
  });
}

export type InboxMove =
  | { action: 'to-note'; todoId: string }
  | { action: 'file-as-task'; todoId: string }
  | { action: 'to-event'; todoId: string }
  | { action: 'to-task'; noteId: string }
  | { action: 'event-to-task'; eventId: string }
  | { action: 'undo'; routingId: string };

function movePath(move: InboxMove): string {
  switch (move.action) {
    case 'to-note':
      return `/todos/${encodeURIComponent(move.todoId)}/to-note`;
    case 'file-as-task':
      return `/todos/${encodeURIComponent(move.todoId)}/file-as-task`;
    case 'to-event':
      return `/todos/${encodeURIComponent(move.todoId)}/to-event`;
    case 'to-task':
      return `/notes/${encodeURIComponent(move.noteId)}/to-task`;
    case 'event-to-task':
      return `/events/${encodeURIComponent(move.eventId)}/to-task`;
    case 'undo':
      return `/inbox/routings/${encodeURIComponent(move.routingId)}/undo`;
  }
}

/** Every move between the Inbox, a task and a note, and taking one back. */
export function useInboxMove() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (move: InboxMove): Promise<InboxRouting> =>
      InboxRoutingResponseSchema.parse(
        (await apiClient.post(movePath(move), undefined, { queueOfflineMutation: false })).data,
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.inboxRoutings });
      void client.invalidateQueries({ queryKey: queryKeys.todos });
      void client.invalidateQueries({ queryKey: queryKeys.events });
      void client.invalidateQueries({ queryKey: ['notes'] });
    },
    retry: false,
  });
}
