import { useState } from 'react';
import { useActiveRunsQuery } from '../../hooks/queries';
import useOpenRunThread from '../../hooks/useOpenRunThread';
import type { AgentRunResponse } from '../../types/api';
import { relativeTime } from '../../utils/formatters';
import { ChevronRightIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';

function runTitle(run: AgentRunResponse): string {
  return run.todo_title || run.instruction;
}

/**
 * The runs going on right now, folded into one line at the top of the panel.
 *
 * The panel opens the same way whatever is running, so a running run is not
 * allowed to take the panel over: it sits above the conversation as a card
 * that unfolds to the list, newest first, and each row opens its thread. The
 * thread already on screen is left out.
 */
export default function ChatPanelRunStrip({ conversationId }: { conversationId: string | null }) {
  const { data: active = [] } = useActiveRunsQuery();
  const openRunThread = useOpenRunThread();
  const [open, setOpen] = useState(false);
  const runs = active
    .filter((run) => !conversationId || run.conversation_id !== conversationId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (runs.length === 0) return null;
  const summary =
    runs.length === 1
      ? translateUi('Running · {{title}}', { title: runTitle(runs[0]) })
      : translateUi('{{count}} running', { count: runs.length });
  return (
    <div className="cc-run-strip" data-testid="chat-panel-run-strip">
      <button
        type="button"
        className="cc-run-strip__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="cc-run-strip__dot" aria-hidden="true" />
        <span className="cc-run-strip__summary">{summary}</span>
        <ChevronRightIcon
          size={14}
          className={`cc-section__chevron${open ? ' cc-section__chevron--open' : ''}`}
        />
      </button>
      {open && (
        <ul className="cc-run-strip__list">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className="cc-run-strip__row"
                onClick={() => void openRunThread(run.id, runTitle(run))}
              >
                <span className="cc-run-strip__title">{runTitle(run)}</span>
                <span className="cc-run-strip__meta">
                  {[run.host_label, relativeTime(run.created_at)].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
