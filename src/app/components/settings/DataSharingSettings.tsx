import { useState } from 'react';
import { useDataSourceLogQuery } from '../../hooks/queries';
import { translateUi } from '../../i18n';
import { platformApi } from '../../platform';
import apiClient from '../../services/apiClient';
import { logger } from '../../services/logger';
import { useAuthStore } from '../../stores/useAuthStore';
import { useSettingsStore, type SharedSourceSetting } from '../../stores/useSettingsStore';
import { useToastStore } from '../../stores/useToastStore';
import type { DataSourceQueryLog } from '../../types/schemas';
import { formatDateTime } from '../../utils/formatters';
import SegmentedControl from '../shared/SegmentedControl';
import SettingsRow from '../shared/SettingsRow';
import SettingsSection from '../shared/SettingsSection';
import Toggle from '../shared/Toggle';

/** Anchor of the section, so first-run setup can open it directly. */
export const DATA_SHARING_SECTION_ID = 'share-this-machine';

function sameServer(a: string | null, b: string): boolean {
  return !!a && a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

function folderName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

/** One folder per line, relative to the shared folder. */
function parseFolders(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^[/\\]+|[/\\]+$/g, ''))
    .filter(Boolean);
}

const LOG_STATUS_LABELS: Record<DataSourceQueryLog['status'], string> = {
  awaiting_approval: 'Awaiting approval',
  queued: 'Waiting',
  claimed: 'Reading',
  done: 'Read',
  failed: 'Not read',
  denied: 'Refused',
  expired: 'Timed out',
};

function statusLabel(row: DataSourceQueryLog): string {
  if (row.op === 'append_todo' && row.status === 'done') return translateUi('Added');
  if (row.op === 'append_todo' && row.status === 'failed') return translateUi('Not added');
  return translateUi(LOG_STATUS_LABELS[row.status]);
}

/** Who asked: a paired device, this workspace's sign-in, or the AI on behalf of a chat or run. */
export function requesterLabel(row: Pick<DataSourceQueryLog, 'requested_by' | 'requester_name'>) {
  if (row.requester_name) return row.requester_name;
  if (row.requested_by === 'chat' || row.requested_by.startsWith('chat:')) {
    return translateUi('AI in a chat');
  }
  if (row.requested_by.startsWith('run:')) return translateUi('AI in a run');
  return translateUi('Signed-in session');
}

function operationLabel(row: DataSourceQueryLog): string {
  if (row.op === 'append_todo') {
    return translateUi('add task to {{path}}', { path: row.path || '' });
  }
  return `${row.op} ${row.path || row.query || '/'}`;
}

function AccessLog({ remoteId }: { remoteId: string }) {
  const [open, setOpen] = useState(false);
  const { data: rows = [], isLoading } = useDataSourceLogQuery(remoteId, open);
  return (
    <div className="cc-data-sharing__log">
      <button type="button" className="cc-btn cc-btn--small" onClick={() => setOpen(!open)}>
        {open ? translateUi('Hide access log') : translateUi('Show access log')}
      </button>
      {open &&
        (isLoading ? (
          <p className="cc-data-sharing__hint">{translateUi('Loading…')}</p>
        ) : rows.length === 0 ? (
          <p className="cc-data-sharing__hint">{translateUi('Nothing has been read yet.')}</p>
        ) : (
          <ul className="cc-data-sharing__log-list">
            {rows.map((row) => (
              <li key={row.id} className={`cc-data-sharing__log-row is-${row.status}`}>
                <span>{formatDateTime(row.created_at)}</span>
                <span>{requesterLabel(row)}</span>
                <span>{operationLabel(row)}</span>
                <span>
                  {statusLabel(row)}
                  {row.error ? ` · ${row.error}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

function SharedSourceCard({ source }: { source: SharedSourceSetting }) {
  const update = useSettingsStore((state) => state.updateSharedSource);
  const remove = useSettingsStore((state) => state.removeSharedSource);
  const [include, setInclude] = useState(source.includeFolders.join('\n'));
  const [exclude, setExclude] = useState(source.excludeFolders.join('\n'));
  const [removing, setRemoving] = useState(false);

  const stopSharing = async () => {
    setRemoving(true);
    try {
      if (source.remoteId) await apiClient.delete(`/data-sources/${source.remoteId}`);
    } catch (error) {
      // Gone already, or the server is unreachable: either way this machine
      // stops answering for it, which is what makes it unreadable.
      logger.warn('Could not remove the data source on the server', error);
    }
    remove(source.id);
  };

  return (
    <div className="cc-data-sharing__source">
      <div className="cc-data-sharing__source-head">
        <div>
          <div className="cc-settings-row__label">{source.name}</div>
          <div className="cc-settings-row__sublabel cc-data-sharing__path">{source.root}</div>
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--danger cc-btn--small"
          disabled={removing}
          onClick={() => void stopSharing()}
        >
          {translateUi('Stop sharing')}
        </button>
      </div>
      <label className="cc-data-sharing__field">
        <span>{translateUi('Shared folders (one per line; empty shares everything)')}</span>
        <textarea
          className="cc-settings-input"
          rows={3}
          value={include}
          placeholder={translateUi('01_Projects')}
          onChange={(event) => setInclude(event.target.value)}
          onBlur={() => update(source.id, { includeFolders: parseFolders(include) })}
        />
      </label>
      <label className="cc-data-sharing__field">
        <span>{translateUi('Never shared (one per line)')}</span>
        <textarea
          className="cc-settings-input"
          rows={2}
          value={exclude}
          placeholder={translateUi('02_Resources/Private')}
          onChange={(event) => setExclude(event.target.value)}
          onBlur={() => update(source.id, { excludeFolders: parseFolders(exclude) })}
        />
      </label>
      <SettingsRow
        label={translateUi('AI access')}
        sublabel={translateUi(
          'Chat and agents may search and read the shared folders. Every read is in the access log.',
        )}
      >
        <Toggle
          checked={source.aiAccess ?? false}
          label={translateUi('AI access to {{name}}', { name: source.name })}
          onChange={(checked) => update(source.id, { aiAccess: checked })}
        />
      </SettingsRow>
      <SettingsRow
        label={translateUi('Allow adding tasks')}
        sublabel={translateUi(
          'A task may be added to a TODO.md in a shared folder, only after you approve it in Attention. Nothing else is ever changed.',
        )}
      >
        <Toggle
          checked={source.allowWrites ?? false}
          label={translateUi('Allow adding tasks to {{name}}', { name: source.name })}
          onChange={(checked) => update(source.id, { allowWrites: checked })}
        />
      </SettingsRow>
      {source.remoteId && <AccessLog remoteId={source.remoteId} />}
    </div>
  );
}

/**
 * Folders on this machine that other devices may read through the current
 * workspace. Read-only unless a folder allows adding tasks, and then only a
 * task line in a `TODO.md`, each one approved in review. The AI sees a folder
 * only when its AI access is on.
 */
export default function DataSharingSettings() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const label = useSettingsStore((state) => state.workerLabel.trim());
  const allSources = useSettingsStore((state) => state.sharedSources);
  const add = useSettingsStore((state) => state.addSharedSource);
  const [kind, setKind] = useState<SharedSourceSetting['kind']>('obsidian_vault');
  const sources = allSources.filter((source) => sameServer(serverUrl, source.serverUrl));

  const addFolder = async () => {
    if (!serverUrl) return;
    let root: string | null;
    try {
      root = await platformApi.server.selectFolder();
    } catch (error) {
      useToastStore.getState().addToast('error', translateUi('Could not open the folder picker.'));
      logger.warn('Folder picker failed', error);
      return;
    }
    if (!root) return;
    const name = folderName(root);
    if (sources.some((source) => source.name === name)) {
      useToastStore
        .getState()
        .addToast('error', translateUi('A folder named {{name}} is already shared.', { name }));
      return;
    }
    add({
      id: crypto.randomUUID(),
      serverUrl,
      root,
      name,
      kind,
      includeFolders: [],
      excludeFolders: [],
    });
  };

  return (
    <SettingsSection id={DATA_SHARING_SECTION_ID} title={translateUi("Share this machine's data")}>
      <p className="cc-data-sharing__hint">
        {translateUi(
          'Your other devices can list, read and search these folders through this workspace while this app is open. Files stay on this machine; the workspace keeps only their names and dates. The AI cannot see them, and nothing is changed, unless you turn that on below.',
        )}
      </p>
      {!label ? (
        <p className="cc-data-sharing__hint">
          {translateUi('Name this machine above before sharing a folder.')}
        </p>
      ) : (
        <>
          {sources.map((source) => (
            <SharedSourceCard key={source.id} source={source} />
          ))}
          <SettingsRow
            label={translateUi('Share a folder')}
            sublabel={translateUi('An Obsidian vault, or any folder of notes.')}
          >
            <div className="cc-data-sharing__add">
              <SegmentedControl
                ariaLabel={translateUi('Kind of folder')}
                options={[
                  { label: translateUi('Obsidian vault'), value: 'obsidian_vault' },
                  { label: translateUi('Folder'), value: 'folder' },
                ]}
                value={kind}
                onChange={(value) => setKind(value as SharedSourceSetting['kind'])}
              />
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => void addFolder()}
              >
                {translateUi('Choose folder…')}
              </button>
            </div>
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}
