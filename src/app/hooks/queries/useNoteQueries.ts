import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { NoteResponseSchema } from '../../types/schemas';

export type Note = z.infer<typeof NoteResponseSchema>;
export function useNotesQuery() {
  const server = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: ['notes', server],
    enabled: !!server,
    queryFn: async ({ signal }) =>
      z.array(NoteResponseSchema).parse((await apiClient.get('/notes', { signal })).data),
    retry: false,
  });
}

type NoteAction =
  | { action: 'create'; content: string; project_id: string | null; idempotency_key: string }
  | { action: 'edit'; id: string; content: string }
  | { action: 'move'; id: string; project_id: string | null }
  | { action: 'delete'; id: string };

export function useNoteAction() {
  const client = useQueryClient();
  const server = useAuthStore((s) => s.serverUrl);
  return useMutation({
    mutationFn: async (input: NoteAction) => {
      const config = { queueOfflineMutation: false };
      if (input.action === 'create') {
        const { action: _, ...body } = input;
        return NoteResponseSchema.parse((await apiClient.post('/notes', body, config)).data);
      }
      const path = `/notes/${encodeURIComponent(input.id)}`;
      if (input.action === 'delete') {
        await apiClient.delete(path, config);
        return null;
      }
      const body =
        input.action === 'move' ? { project_id: input.project_id } : { content: input.content };
      return NoteResponseSchema.parse((await apiClient.patch(path, body, config)).data);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notes', server] });
    },
    retry: false,
  });
}
