import { useNavigate } from 'react-router-dom';
import { useActiveRunsQuery, useRunsAwaitingInputQuery } from '../../hooks/queries';
import type { AgentRunResponse } from '../../types/api';
import { translateUi } from '../../i18n';

function runTitle(run: AgentRunResponse): string {
  const title = run.todo_title || run.instruction;
  return title.length > 48 ? `${title.slice(0, 47)}…` : title;
}

/** Where a click on the line should land: the one run, or the list of them. */
export function activeRunsHref(
  active: AgentRunResponse[],
  awaitingInput: AgentRunResponse[],
): string | null {
  if (awaitingInput.length > 0) return '/attention';
  if (active.length === 1) return `/attention?view=runs&run_id=${active[0].id}`;
  if (active.length > 1) return '/attention?view=runs';
  return null;
}

/**
 * Whether Home is working right now, visible from every screen.
 *
 * One line in the sidebar foot: a green dot while runs are going, orange
 * when one has stopped to ask something. Nothing at all when nothing runs.
 * The click opens the run where it already lives: the Attention page.
 */
export default function ActiveRunsLine() {
  const navigate = useNavigate();
  const { data: active = [] } = useActiveRunsQuery();
  const { data: awaitingInput = [] } = useRunsAwaitingInputQuery();
  const href = activeRunsHref(active, awaitingInput);
  if (!href) return null;

  const needsAnswer = awaitingInput.length > 0;
  const label = needsAnswer
    ? awaitingInput.length === 1
      ? translateUi('Needs an answer · {{title}}', { title: runTitle(awaitingInput[0]) })
      : translateUi('{{count}} need an answer', { count: awaitingInput.length })
    : active.length === 1
      ? translateUi('Running · {{title}}', { title: runTitle(active[0]) })
      : translateUi('{{count}} running', { count: active.length });

  return (
    <button
      type="button"
      className={`cc-connection-status cc-active-runs cc-active-runs--${needsAnswer ? 'needs-answer' : 'running'}`}
      title={translateUi('Open what is running')}
      onClick={() => navigate(href)}
    >
      <span className="cc-connection-status__dot" aria-hidden="true" />
      <span className="cc-sidebar__label">{label}</span>
    </button>
  );
}
