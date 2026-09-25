import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { translateUi } from '../../i18n';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { AIModelCatalogSchema, AIModelSelectionSchema } from '../../types/schemas';
import SettingsRow from '../shared/SettingsRow';

export default function AIModelSettings({
  provider,
  onSaved,
}: {
  provider: string;
  onSaved: () => void;
}) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const [draft, setDraft] = useState<string | null>(null);
  const endpoint = `/admin/ai/models/${provider}`;
  const query = useQuery({
    queryKey: ['ai-models', serverUrl, provider],
    queryFn: async ({ signal }) =>
      AIModelCatalogSchema.parse((await apiClient.get(endpoint, { signal })).data),
    retry: false,
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: async (model: string) =>
      AIModelSelectionSchema.parse(
        (await apiClient.put(endpoint, { model }, { queueOfflineMutation: false })).data,
      ),
    onSuccess: () => {
      void query.refetch();
      onSaved();
    },
    retry: false,
  });
  const value = draft ?? query.data?.model ?? '';
  return (
    <SettingsRow
      label={translateUi('AI model')}
      sublabel={translateUi(
        'Choose a model or enter its ID. Applies to new Agent Todo requests; existing CLI sessions keep their model.',
      )}
    >
      <div>
        <div className="cc-settings-inline-actions">
          <input
            className="cc-settings-input"
            aria-label={translateUi('AI model')}
            list={`ai-models-${provider}`}
            value={value}
            maxLength={200}
            disabled={query.isLoading || save.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              save.reset();
            }}
            placeholder={
              provider === 'codex' ? translateUi('gpt-6-sol') : translateUi('CLI default (empty)')
            }
          />
          <datalist id={`ai-models-${provider}`}>
            {query.data?.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            disabled={query.isLoading || save.isPending || (provider === 'codex' && !value.trim())}
            onClick={() => save.mutate(value.trim())}
          >
            {translateUi('Save model')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            disabled={query.isFetching || save.isPending}
            onClick={() => {
              void query.refetch();
            }}
          >
            {translateUi('Refresh models')}
          </button>
        </div>
        {query.data?.source === 'suggestions' && (
          <p role="status">
            {translateUi(
              'Live model discovery unavailable. Suggestions do not confirm account access.',
            )}
          </p>
        )}
        {query.data?.source === 'aliases' && (
          <p>{translateUi('Claude aliases follow your CLI and account settings.')}</p>
        )}
        {query.isError && (
          <p role="alert">{translateUi('Could not load models. Refresh to retry.')}</p>
        )}
        {save.isError && <p role="alert">{translateUi('Could not save the model.')}</p>}
        {save.isSuccess && (
          <p role="status">
            {translateUi(
              save.data.persistent
                ? 'Model saved for this server.'
                : 'Model saved until the server restarts.',
            )}
          </p>
        )}
      </div>
    </SettingsRow>
  );
}
