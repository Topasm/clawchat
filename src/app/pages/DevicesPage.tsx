import { useEffect, useState } from 'react';
import EmptyState from '../components/shared/EmptyState';
import { DevicesIcon } from '../components/shared/NavIcons';
import { StatusDot } from '../components/shared/WorkspacePrimitives';
import { dataSourceErrorReason, useDataSourceQuery, useDataSourcesQuery } from '../hooks/queries';
import { translateUi } from '../i18n';
import type { DataSource, DataSourceQueryResult } from '../types/schemas';
import { formatDateTime } from '../utils/formatters';

type View =
  | { kind: 'folder'; path: string }
  | { kind: 'file'; path: string }
  | { kind: 'search'; path: string; query: string };

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

function lastSeen(source: { last_seen_at?: string | null }): string {
  return source.last_seen_at
    ? translateUi('Offline · last seen {{time}}', { time: formatDateTime(source.last_seen_at) })
    : translateUi('Offline · never connected');
}

function Breadcrumbs({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  const parts = path ? path.split('/') : [];
  return (
    <nav className="cc-devices__crumbs" aria-label={translateUi('Folder path')}>
      <button type="button" className="cc-devices__crumb" onClick={() => onOpen('')}>
        {translateUi('Top')}
      </button>
      {parts.map((part, index) => {
        const target = parts.slice(0, index + 1).join('/');
        return (
          <span key={target}>
            <span className="cc-devices__crumb-sep">/</span>
            <button type="button" className="cc-devices__crumb" onClick={() => onOpen(target)}>
              {part}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/** Why the answer came from Home's index instead of the machine, if it did. */
function CacheNotice({ result, source }: { result: DataSourceQueryResult; source: DataSource }) {
  if (result.origin !== 'cache') return null;
  return (
    <p className="cc-devices__notice" role="status">
      {result.fallback_reason === 'timeout'
        ? translateUi('{{host}} did not answer in time. Showing the last list it sent.', {
            host: source.host_label,
          })
        : `${lastSeen(result)}. ${translateUi('Showing the last list it sent; files cannot be opened until it is back.')}`}
    </p>
  );
}

function QueryError({ error, source }: { error: unknown; source: DataSource }) {
  const { code, reason, message } = dataSourceErrorReason(error);
  let text: string;
  if (code === 'DATA_SOURCE_OFFLINE') {
    text = translateUi(
      'This file is on {{host}}, which is offline. Its contents are never stored anywhere else, so it opens once {{host}} is back.',
      { host: source.host_label },
    );
  } else if (code === 'DATA_SOURCE_TIMEOUT') {
    text = translateUi('{{host}} did not answer in time. Try again.', { host: source.host_label });
  } else if (code === 'FORBIDDEN' || reason) {
    text = translateUi('This part of {{name}} is not shared.', { name: source.name });
  } else if (code === 'NOT_FOUND') {
    text = translateUi('Nothing exists at that path any more.');
  } else {
    text = message ?? translateUi('Could not reach the workspace.');
  }
  return (
    <p className="cc-devices__error" role="alert">
      {text}
    </p>
  );
}

function FolderView({
  source,
  path,
  onOpen,
}: {
  source: DataSource;
  path: string;
  onOpen: (view: View) => void;
}) {
  const { data, error, isLoading } = useDataSourceQuery(source.id, { op: 'list', path });
  if (isLoading) {
    return (
      <p className="cc-devices__hint">
        {translateUi('Asking {{host}}…', { host: source.host_label })}
      </p>
    );
  }
  if (error || !data) return <QueryError error={error} source={source} />;
  return (
    <>
      <CacheNotice result={data} source={source} />
      {data.entries.length === 0 ? (
        <p className="cc-devices__hint">{translateUi('This folder is empty.')}</p>
      ) : (
        <ul className="cc-devices__entries">
          {data.entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className={`cc-devices__entry${entry.is_dir ? ' cc-devices__entry--dir' : ''}`}
                onClick={() => onOpen({ kind: entry.is_dir ? 'folder' : 'file', path: entry.path })}
              >
                <span className="cc-devices__entry-name">
                  {entry.is_dir ? `${entry.name}/` : entry.title}
                </span>
                {entry.modified_at && (
                  <span className="cc-devices__entry-date">
                    {formatDateTime(entry.modified_at)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.truncated && (
        <p className="cc-devices__hint">
          {translateUi('Only the first part of this folder is shown.')}
        </p>
      )}
    </>
  );
}

function FileView({ source, path }: { source: DataSource; path: string }) {
  const { data, error, isLoading } = useDataSourceQuery(source.id, { op: 'read', path });
  if (isLoading) {
    return (
      <p className="cc-devices__hint">
        {translateUi('Asking {{host}}…', { host: source.host_label })}
      </p>
    );
  }
  if (error || !data) return <QueryError error={error} source={source} />;
  return (
    <article className="cc-devices__file">
      {data.tasks && data.tasks.length > 0 && (
        <ul className="cc-devices__tasks" aria-label={translateUi('Checklist')}>
          {data.tasks.map((task, index) => (
            <li
              key={`${index}-${task.title}`}
              className={task.status === 'completed' ? 'is-done' : undefined}
            >
              <input type="checkbox" checked={task.status === 'completed'} readOnly disabled />
              <span>{task.title}</span>
              {task.due_date && <span className="cc-devices__task-due">{task.due_date}</span>}
            </li>
          ))}
        </ul>
      )}
      <pre className="cc-devices__content">{data.content}</pre>
      {data.truncated && (
        <p className="cc-devices__hint">
          {translateUi('The file is long; only its beginning is shown.')}
        </p>
      )}
    </article>
  );
}

function SearchView({
  source,
  path,
  query,
  onOpen,
}: {
  source: DataSource;
  path: string;
  query: string;
  onOpen: (view: View) => void;
}) {
  const { data, error, isLoading } = useDataSourceQuery(source.id, { op: 'search', path, query });
  if (isLoading) {
    return (
      <p className="cc-devices__hint">
        {translateUi('Searching on {{host}}…', { host: source.host_label })}
      </p>
    );
  }
  if (error || !data) return <QueryError error={error} source={source} />;
  return (
    <>
      {data.origin === 'cache' && (
        <p className="cc-devices__notice" role="status">
          {translateUi('{{host}} is not answering, so only file names were searched.', {
            host: source.host_label,
          })}
        </p>
      )}
      {data.matches.length === 0 ? (
        <p className="cc-devices__hint">{translateUi('Nothing matched.')}</p>
      ) : (
        <ul className="cc-devices__entries">
          {data.matches.map((match) => (
            <li key={`${match.path}:${match.line ?? 0}`}>
              <button
                type="button"
                className="cc-devices__entry"
                onClick={() => onOpen({ kind: 'file', path: match.path })}
              >
                <span className="cc-devices__entry-name">{match.title}</span>
                <span className="cc-devices__entry-date">{match.path}</span>
                {match.snippet && <span className="cc-devices__snippet">{match.snippet}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SourceBrowser({ source }: { source: DataSource }) {
  const [view, setView] = useState<View>({ kind: 'folder', path: '' });
  const [search, setSearch] = useState('');
  const folder = view.kind === 'file' ? parentOf(view.path) : view.path;
  const canSearch = source.capabilities.includes('search');

  return (
    <section className="cc-devices__browser" aria-label={source.name}>
      <div className="cc-devices__toolbar">
        <Breadcrumbs
          path={view.kind === 'file' ? view.path : folder}
          onOpen={(path) => setView({ kind: 'folder', path })}
        />
        {canSearch && (
          <form
            className="cc-devices__search"
            onSubmit={(event) => {
              event.preventDefault();
              const query = search.trim();
              if (query) setView({ kind: 'search', path: folder, query });
            }}
          >
            <input
              className="cc-settings-input"
              type="search"
              value={search}
              placeholder={translateUi('Search {{name}}', { name: source.name })}
              aria-label={translateUi('Search {{name}}', { name: source.name })}
              onChange={(event) => setSearch(event.target.value)}
            />
          </form>
        )}
      </div>
      {view.kind === 'folder' && <FolderView source={source} path={view.path} onOpen={setView} />}
      {view.kind === 'file' && <FileView source={source} path={view.path} />}
      {view.kind === 'search' && (
        <SearchView source={source} path={view.path} query={view.query} onOpen={setView} />
      )}
    </section>
  );
}

/**
 * Folders that other machines share through this workspace.
 *
 * The files stay on the machine that has them: every listing, file and
 * search is asked of that machine at the moment it is opened. When it is off,
 * the workspace still knows the names and dates it last sent, never more.
 */
export default function DevicesPage() {
  const { data: sources = [], isLoading } = useDataSourcesQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sources.find((source) => source.id === selectedId) ?? sources[0] ?? null;

  useEffect(() => {
    if (selectedId && !sources.some((source) => source.id === selectedId)) setSelectedId(null);
  }, [selectedId, sources]);

  return (
    <div className="cc-devices">
      <header className="cc-page-header">
        <div>
          <h1 className="cc-page-header__title">{translateUi('Devices')}</h1>
          <p className="cc-page-header__subtitle">
            {translateUi(
              'Folders your other machines share through this workspace. Files are read from the machine when you open them.',
            )}
          </p>
        </div>
      </header>

      {isLoading ? (
        <p className="cc-devices__hint">{translateUi('Loading…')}</p>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<DevicesIcon size={28} />}
          message={translateUi(
            "No machine shares a folder yet. In the desktop app, open Settings and choose a folder under Share this machine's data.",
          )}
        />
      ) : (
        <>
          <div
            className="cc-devices__sources"
            role="tablist"
            aria-label={translateUi('Shared folders')}
          >
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                role="tab"
                aria-selected={source.id === selected?.id}
                className={`cc-devices__source${source.id === selected?.id ? ' is-selected' : ''}`}
                onClick={() => setSelectedId(source.id)}
              >
                <span className="cc-devices__source-name">{source.name}</span>
                <span className="cc-devices__source-host">
                  <StatusDot tone={source.is_online ? 'success' : 'neutral'} />
                  {source.host_label}
                  {' · '}
                  {source.is_online ? translateUi('Online') : lastSeen(source)}
                </span>
              </button>
            ))}
          </div>
          {selected && <SourceBrowser key={selected.id} source={selected} />}
        </>
      )}
    </div>
  );
}
