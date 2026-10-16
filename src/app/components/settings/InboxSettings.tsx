import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { translateUi } from '../../i18n';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { queryKeys } from '../../hooks/queries';
import SettingsRow from '../shared/SettingsRow';
import SettingsSection from '../shared/SettingsSection';
import Toggle from '../shared/Toggle';

const StoredSettingsSchema = z.object({
  settings: z.object({ inboxAutoOrganize: z.boolean().optional() }).passthrough(),
});

/** Whether the Inbox files captures as tasks or notes by itself (on unless turned off). */
export default function InboxSettings() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const queryClient = useQueryClient();
  const queryKey = ['inbox-settings', serverUrl];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      StoredSettingsSchema.parse((await apiClient.get('/settings', { signal })).data).settings
        .inboxAutoOrganize !== false,
    retry: false,
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiClient.put(
        '/settings',
        { inboxAutoOrganize: enabled },
        { queueOfflineMutation: false },
      );
      return enabled;
    },
    onSuccess: (enabled) => {
      queryClient.setQueryData(queryKey, enabled);
      void queryClient.invalidateQueries({ queryKey: queryKeys.inboxRoutings });
    },
    retry: false,
  });
  return (
    <SettingsSection title={translateUi('Inbox')}>
      <SettingsRow
        label={translateUi('Organize the Inbox automatically')}
        sublabel={translateUi(
          'A capture with a date becomes a task due that day; an idea becomes a note. When unsure it is still filed and marked, so you can change where it went.',
        )}
      >
        <Toggle
          checked={query.data ?? true}
          disabled={query.isLoading || save.isPending}
          label={translateUi('Organize the Inbox automatically')}
          onChange={(enabled) => save.mutate(enabled)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
