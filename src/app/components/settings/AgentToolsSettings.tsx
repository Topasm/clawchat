import { useEffect, useState } from 'react';
import {
  useAgentToolSettingsQuery,
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServersQuery,
  useRefreshMcpServer,
  useSaveSearxngUrl,
  useTestSearxng,
  useUpdateMcpServer,
  type ToolTrust,
} from '../../hooks/queries';
import { translateUi, useTranslation } from '../../i18n';
import { parsePairs, splitCommandLine } from '../../services/mcpServerForm';
import type { McpServer } from '../../types/schemas';
import SettingsRow from '../shared/SettingsRow';
import SettingsSection from '../shared/SettingsSection';

const TRUST_OPTIONS: { value: ToolTrust; label: string }[] = [
  { value: 'approval', label: 'Ask before each call' },
  { value: 'read_only', label: 'Run without asking' },
];

function WebSearchRow() {
  const { data } = useAgentToolSettingsQuery();
  const save = useSaveSearxngUrl();
  const test = useTestSearxng();
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(data?.searxng_url ?? ''), [data?.searxng_url]);
  const result = test.data;

  return (
    <SettingsRow
      label={translateUi('Web search (SearXNG)')}
      sublabel={translateUi(
        'Offered to the Research skill. Searches run on your own SearXNG instance with JSON output enabled.',
      )}
    >
      <div className="cc-agent-tools__stack">
        <div className="cc-settings-inline-actions">
          <input
            className="cc-settings-input"
            value={url}
            placeholder={translateUi('http://localhost:8888')}
            aria-label={translateUi('SearXNG address')}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button
            type="button"
            className="cc-btn cc-btn--compact"
            disabled={!url.trim() || test.isPending}
            onClick={() => test.mutate(url.trim())}
          >
            {translateUi('Test')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--primary cc-btn--compact"
            disabled={save.isPending || url.trim() === (data?.searxng_url ?? '')}
            onClick={() => save.mutate(url.trim() || null)}
          >
            {translateUi('Save')}
          </button>
        </div>
        {result && (
          <span className="cc-agent-tools__note" role="status">
            {result.ok
              ? translateUi('Working: {{count}} results for a test search', {
                  count: result.result_count,
                })
              : result.error}
          </span>
        )}
      </div>
    </SettingsRow>
  );
}

function ServerRow({ server }: { server: McpServer }) {
  const update = useUpdateMcpServer();
  const refresh = useRefreshMcpServer();
  const remove = useDeleteMcpServer();
  const target =
    server.transport === 'http'
      ? server.url
      : [server.command, ...server.args].filter(Boolean).join(' ');

  return (
    <li className="cc-agent-tools__server">
      <div className="cc-agent-tools__server-head">
        <strong>{server.name}</strong>
        <span className="cc-agent-tools__note">
          {translateUi('{{count}} tools', { count: server.tools.length })}
        </span>
        <label className="cc-agent-tools__toggle">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(event) =>
              update.mutate({ id: server.id, changes: { enabled: event.target.checked } })
            }
          />
          <span>{translateUi('On')}</span>
        </label>
      </div>
      <code className="cc-agent-tools__target">{target}</code>
      {server.tools.length > 0 && (
        <p className="cc-agent-tools__note">{server.tools.map((tool) => tool.name).join(', ')}</p>
      )}
      {server.last_error && <p className="cc-agent-tools__error">{server.last_error}</p>}
      <div className="cc-settings-inline-actions">
        <select
          className="cc-settings-input"
          aria-label={translateUi('When agents call these tools')}
          value={server.trust}
          onChange={(event) =>
            update.mutate({ id: server.id, changes: { trust: event.target.value as ToolTrust } })
          }
        >
          {TRUST_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {translateUi(option.label)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="cc-btn cc-btn--compact"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate(server.id)}
        >
          {translateUi('Refresh tools')}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--danger cc-btn--compact"
          disabled={remove.isPending}
          onClick={() => remove.mutate(server.id)}
        >
          {translateUi('Remove')}
        </button>
      </div>
    </li>
  );
}

function AddServerForm({ onDone }: { onDone: () => void }) {
  const create = useCreateMcpServer();
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [commandLine, setCommandLine] = useState('');
  const [env, setEnv] = useState('');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('');
  const [trust, setTrust] = useState<ToolTrust>('approval');
  const words = splitCommandLine(commandLine);
  const ready =
    /^[a-z0-9][a-z0-9_-]{0,39}$/.test(name) &&
    (transport === 'stdio' ? words.length > 0 : /^https?:\/\/\S+$/.test(url.trim()));

  return (
    <form
      className="cc-agent-tools__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        create.mutate(
          transport === 'stdio'
            ? {
                name,
                transport,
                command: words[0],
                args: words.slice(1),
                env: parsePairs(env, '='),
                trust,
              }
            : { name, transport, url: url.trim(), headers: parsePairs(headers, ':'), trust },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="cc-settings-inline-actions">
        <input
          className="cc-settings-input"
          value={name}
          placeholder={translateUi('files')}
          aria-label={translateUi('Server name (lowercase letters, numbers, - and _)')}
          onChange={(event) => setName(event.target.value.toLowerCase())}
        />
        <select
          className="cc-settings-input"
          aria-label={translateUi('How to connect')}
          value={transport}
          onChange={(event) => setTransport(event.target.value as 'stdio' | 'http')}
        >
          <option value="stdio">{translateUi('Start a command')}</option>
          <option value="http">{translateUi('Connect to a URL')}</option>
        </select>
        <select
          className="cc-settings-input"
          aria-label={translateUi('When agents call these tools')}
          value={trust}
          onChange={(event) => setTrust(event.target.value as ToolTrust)}
        >
          {TRUST_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {translateUi(option.label)}
            </option>
          ))}
        </select>
      </div>
      {transport === 'stdio' ? (
        <>
          <input
            className="cc-settings-input cc-agent-tools__wide"
            value={commandLine}
            placeholder={translateUi(
              'npx -y @modelcontextprotocol/server-filesystem /home/me/notes',
            )}
            aria-label={translateUi('Command')}
            onChange={(event) => setCommandLine(event.target.value)}
          />
          <textarea
            className="cc-settings-input cc-agent-tools__wide"
            rows={2}
            value={env}
            placeholder={translateUi('API_KEY=…')}
            aria-label={translateUi('Environment variables, one KEY=value per line')}
            onChange={(event) => setEnv(event.target.value)}
          />
        </>
      ) : (
        <>
          <input
            className="cc-settings-input cc-agent-tools__wide"
            value={url}
            placeholder={translateUi('https://example.com/mcp')}
            aria-label={translateUi('MCP endpoint URL')}
            onChange={(event) => setUrl(event.target.value)}
          />
          <textarea
            className="cc-settings-input cc-agent-tools__wide"
            rows={2}
            value={headers}
            placeholder={translateUi('Authorization: Bearer …')}
            aria-label={translateUi('Headers, one Name: value per line')}
            onChange={(event) => setHeaders(event.target.value)}
          />
        </>
      )}
      <p className="cc-agent-tools__note">
        {translateUi(
          'Secrets are stored on your server and never shown again. A command runs on the server machine with your permissions.',
        )}
      </p>
      <div className="cc-settings-inline-actions">
        <button type="button" className="cc-btn cc-btn--compact" onClick={onDone}>
          {translateUi('Cancel')}
        </button>
        <button
          type="submit"
          className="cc-btn cc-btn--primary cc-btn--compact"
          disabled={!ready || create.isPending}
        >
          {translateUi('Add server')}
        </button>
      </div>
    </form>
  );
}

/** Web search and MCP servers the server's agents may use. */
export default function AgentToolsSettings() {
  const { t } = useTranslation();
  const { data: servers = [] } = useMcpServersQuery();
  const [adding, setAdding] = useState(false);

  return (
    <SettingsSection title={t('workspaceSettings.sections.agentTools')} id="agent-tools">
      <WebSearchRow />
      {/* A full-width block: the server list does not fit a label/control row. */}
      <div className="cc-agent-tools__block">
        <div className="cc-settings-row__label">{translateUi('MCP servers')}</div>
        <div className="cc-settings-row__sublabel">
          {translateUi(
            'Their tools are offered to every skill. Servers set to ask pause the run in Attention until you allow each call.',
          )}
        </div>
        <div className="cc-agent-tools__stack">
          {servers.length > 0 && (
            <ul className="cc-agent-tools__servers">
              {servers.map((server) => (
                <ServerRow key={server.id} server={server} />
              ))}
            </ul>
          )}
          {adding ? (
            <AddServerForm onDone={() => setAdding(false)} />
          ) : (
            <div>
              <button
                type="button"
                className="cc-btn cc-btn--compact"
                onClick={() => setAdding(true)}
              >
                {translateUi('Add MCP server')}
              </button>
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
