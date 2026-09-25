import { useState } from 'react';
import { translateUi } from '../../i18n';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  type CliSession,
  useCliSessionsQuery,
  useCliSessionDetailQuery,
  useCliSessionAction,
} from '../../hooks/queries/useCliSessionQueries';

const STATUS: Record<CliSession['status'], string> = {
  running: 'Running',
  waiting_input: 'Waiting for input',
  idle: 'Idle',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
  unknown: 'Saved session',
};

function SessionDetails({ session }: { session: CliSession }) {
  const detail = useCliSessionDetailQuery(session);
  const action = useCliSessionAction();
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const current = detail.data?.session ?? session;
  return (
    <div className="cc-cli-session__details">
      {detail.isLoading && <p>{translateUi('Loading session…')}</p>}
      {detail.isError && (
        <div role="alert">
          <p>{translateUi('Could not load session. Refresh to retry.')}</p>
          <button
            type="button"
            className="cc-btn"
            onClick={() => {
              void detail.refetch();
            }}
          >
            {translateUi('Retry')}
          </button>
        </div>
      )}
      {detail.data?.output && <pre className="cc-cli-session__output">{detail.data.output}</pre>}
      {current.kind === 'interactive' && current.provider === 'claude' && (
        <p>
          {translateUi(
            'Manage this foreground Claude session in its original terminal. Background sessions support logs, stop, and restart here.',
          )}
        </p>
      )}
      {current.can_send && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim() || action.isPending) return;
            action.mutate(
              { session: current, action: 'message', message },
              { onSuccess: () => setMessage('') },
            );
          }}
        >
          <label>
            {translateUi('Follow-up instruction')}
            <textarea
              value={message}
              maxLength={10000}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <button className="cc-btn cc-btn--primary" disabled={!message.trim() || action.isPending}>
            {translateUi('Send to session')}
          </button>
        </form>
      )}
      <div className="cc-run-card__actions">
        {current.can_stop && (
          <button
            type="button"
            className="cc-btn"
            disabled={action.isPending}
            onClick={() => action.mutate({ session: current, action: 'stop' })}
          >
            {translateUi('Stop session')}
          </button>
        )}
        {current.can_restart && (
          <button
            type="button"
            className="cc-btn"
            disabled={action.isPending}
            onClick={() => action.mutate({ session: current, action: 'restart' })}
          >
            {translateUi('Restart session')}
          </button>
        )}
        {current.resume_command && (
          <button
            type="button"
            className="cc-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(current.resume_command!);
                setCopied(true);
                setCopyFailed(false);
              } catch {
                setCopyFailed(true);
              }
            }}
          >
            {translateUi(copied ? 'Copied' : 'Copy terminal command')}
          </button>
        )}
      </div>
      {current.resume_command && <code>{current.resume_command}</code>}
      {copyFailed && <p role="alert">{translateUi('Could not copy. Select the command above.')}</p>}
      {action.isSuccess && <p role="status">{translateUi('Session action accepted')}</p>}
      {action.isError && (
        <p role="alert">{translateUi('Could not confirm the action. Refresh before retrying.')}</p>
      )}
    </div>
  );
}

export default function CliSessionsPanel() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return <CliSessionsContent key={serverUrl} />;
}

function CliSessionsContent() {
  const query = useCliSessionsQuery();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [provider, setProvider] = useState('all');
  const [search, setSearch] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const sessions = (query.data?.sessions ?? []).filter(
    (session) =>
      (provider === 'all' || session.provider === provider) &&
      (showSaved || !['history'].includes(session.kind)) &&
      `${session.title} ${session.cwd}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section id="cli-sessions" className="cc-cli-sessions" aria-label={translateUi('CLI sessions')}>
      <header className="cc-run-card__header">
        <div>
          <h2>{translateUi('CLI sessions')}</h2>
          <p>
            {translateUi(
              'Codex and Claude Code sessions on the connected host. Updates every 5 seconds.',
            )}
          </p>
        </div>
        <button
          type="button"
          className="cc-btn"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          {translateUi('Refresh')}
        </button>
      </header>
      <div className="cc-cli-sessions__filters">
        <select
          aria-label={translateUi('CLI provider')}
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          <option value="all">{translateUi('All providers')}</option>
          <option value="codex">{translateUi('Codex')}</option>
          <option value="claude">{translateUi('Claude Code')}</option>
        </select>
        <input
          aria-label={translateUi('Search sessions')}
          placeholder={translateUi('Search sessions')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={showSaved}
            onChange={(event) => setShowSaved(event.target.checked)}
          />
          {translateUi('Show saved sessions')}
        </label>
      </div>
      {query.data?.providers
        .filter((state) => state.message)
        .map((state) => (
          <p key={state.provider} role="status">
            {translateUi(state.provider === 'codex' ? 'Codex' : 'Claude Code')}:{' '}
            {translateUi(state.message!)}
          </p>
        ))}
      {query.isError && (
        <p role="alert">
          {translateUi('Could not load CLI sessions. Check the host connection and retry.')}
        </p>
      )}
      {query.isLoading ? (
        <p>{translateUi('Loading sessions…')}</p>
      ) : (
        !query.isError &&
        sessions.length === 0 && <p>{translateUi('No CLI sessions match this view.')}</p>
      )}
      <div className="cc-run-list">
        {sessions.map((session) => {
          const id = `${session.provider}:${session.id}`;
          return (
            <article key={id} className={`cc-run-card cc-run-card--${session.status}`}>
              <button
                type="button"
                className="cc-cli-session__toggle"
                aria-expanded={expanded === id}
                onClick={() => setExpanded(expanded === id ? null : id)}
              >
                <span className="cc-run-card__identity">
                  <span>{translateUi(session.provider === 'codex' ? 'Codex' : 'Claude Code')}</span>
                  <strong>{session.title}</strong>
                  <span>{session.cwd}</span>
                </span>
                <span className="cc-run-status">{translateUi(STATUS[session.status])}</span>
              </button>
              {session.waiting_for && <p>{session.waiting_for}</p>}
              {expanded === id && <SessionDetails key={id} session={session} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}
