import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveRunsQuery, useRunsAwaitingInputQuery } from '../../hooks/queries';
import useOpenRunThread from '../../hooks/useOpenRunThread';
import { useOptionalChatPanelController } from '../chat-panel/ChatPanelControllerContext';
import { useRunNoticeStore } from '../../stores/useRunNoticeStore';
import type { AgentRunResponse } from '../../types/api';
import { relativeTime } from '../../utils/formatters';
import { translateUi } from '../../i18n';

/** How long "Done" stays on the line once the last run has finished. */
const DONE_FLASH_MS = 3000;

function runTitle(run: AgentRunResponse): string {
  const title = run.todo_title || run.instruction;
  return title.length > 48 ? `${title.slice(0, 47)}…` : title;
}

/** "‹task› · ‹machine› · 3m ago", for the hover on the one running thing. */
function runDetail(run: AgentRunResponse): string {
  return [runTitle(run), run.host_label, relativeTime(run.created_at)].filter(Boolean).join(' · ');
}

export type ActiveRunsTone = 'running' | 'needs-answer' | 'failed' | 'done';

export interface ActiveRunsLineState {
  tone: ActiveRunsTone;
  label: string;
  detail: string | null;
  /** The one run the line stands for, when it stands for one. */
  run: AgentRunResponse | null;
  /** The runs listed behind the line when it stands for several. */
  runs: AgentRunResponse[];
}

/**
 * What the line says, most urgent first: a question beats a failure, a
 * failure beats work in progress, and "Done" shows only when nothing else is
 * going on.
 */
export function describeActiveRuns(
  active: AgentRunResponse[],
  awaitingInput: AgentRunResponse[],
  failed: { runId: string; title: string }[],
  doneFlash: boolean,
): ActiveRunsLineState | null {
  if (awaitingInput.length > 0) {
    return {
      tone: 'needs-answer',
      label:
        awaitingInput.length === 1
          ? translateUi('Needs an answer')
          : translateUi('{{count}} need an answer', { count: awaitingInput.length }),
      detail: runDetail(awaitingInput[0]),
      run: awaitingInput[0],
      runs: awaitingInput,
    };
  }
  if (failed.length > 0) {
    return {
      tone: 'failed',
      label: translateUi('{{count}} failed', { count: failed.length }),
      detail: failed[0].title,
      run: null,
      runs: [],
    };
  }
  if (active.length === 1) {
    return {
      tone: 'running',
      label: translateUi('1 running'),
      detail: runDetail(active[0]),
      run: active[0],
      runs: active,
    };
  }
  if (active.length > 1) {
    const latest = [...active].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      tone: 'running',
      label: translateUi('{{count}} running', { count: active.length }),
      detail: latest.map(runTitle).join('\n'),
      run: null,
      runs: latest,
    };
  }
  if (doneFlash) {
    return { tone: 'done', label: translateUi('Done'), detail: null, run: null, runs: [] };
  }
  return null;
}

/**
 * Whether Home is working right now, in the same place on every screen.
 *
 * One line in the sidebar foot: green while runs are going, amber when one
 * has stopped to ask something, red while a failure has not been looked at,
 * and "Done" for a moment once the last run finishes. Nothing at all when
 * nothing runs. A click opens the run's thread in the AI panel, so the
 * keyboard shortcut keeps its one meaning and the line is how a run is reached.
 */
export default function ActiveRunsLine() {
  const navigate = useNavigate();
  const panel = useOptionalChatPanelController();
  const openRunThread = useOpenRunThread();
  const { data: active = [] } = useActiveRunsQuery();
  const { data: awaitingInput = [] } = useRunsAwaitingInputQuery();
  const failed = useRunNoticeStore((state) => state.failed);
  const dismissFailed = useRunNoticeStore((state) => state.dismissFailed);

  // "Done" for a moment once the last run finishes, then nothing again.
  const [doneFlash, setDoneFlash] = useState(false);
  const hadActive = useRef(false);
  useEffect(() => {
    if (active.length > 0) {
      hadActive.current = true;
      setDoneFlash(false);
      return;
    }
    if (!hadActive.current) return;
    hadActive.current = false;
    setDoneFlash(true);
    const timer = window.setTimeout(() => setDoneFlash(false), DONE_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [active.length]);

  const state = describeActiveRuns(active, awaitingInput, failed, doneFlash);

  const open = () => {
    if (!state) return;
    if (state.tone === 'failed') {
      const [first] = failed;
      dismissFailed(first.runId);
      void openRunThread(first.runId, first.title);
      return;
    }
    if (state.run) {
      void openRunThread(state.run.id, runTitle(state.run));
      return;
    }
    // Several at once: the panel lists them, newest first.
    if (panel) panel.open();
    else navigate('/attention?view=runs');
  };

  return (
    <div className="cc-active-runs-slot" aria-live="polite">
      {state && (
        <button
          type="button"
          className={`cc-connection-status cc-active-runs cc-active-runs--${state.tone}`}
          title={state.detail ?? undefined}
          disabled={state.tone === 'done'}
          onClick={open}
        >
          <span className="cc-connection-status__dot" aria-hidden="true" />
          <span className="cc-sidebar__label">{state.label}</span>
        </button>
      )}
    </div>
  );
}
