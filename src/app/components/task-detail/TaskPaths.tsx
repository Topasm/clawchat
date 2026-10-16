import { useState } from 'react';
import { useAddTodoPath, useDeleteTodoPath, useTodoPathsQuery } from '../../hooks/queries';
import type { TodoPathKind, TodoPathResponse } from '../../types/api';
import usePlatform from '../../hooks/usePlatform';
import { platformApi } from '../../platform';
import { useWorkerStore } from '../../stores/useWorkerStore';
import { useToastStore } from '../../stores/useToastStore';
import { translateUi } from '../../i18n';

/** Decide a pasted string's kind from its shape: a URL, a vault note, or a folder. */
export function detectPathKind(text: string): TodoPathKind {
  const value = text.trim();
  if (/^(https?:\/\/|www\.)/i.test(value)) return 'url';
  if (/^(\/|~|[A-Za-z]:[\\/])/.test(value)) return 'device';
  if (/\.md$/i.test(value)) return 'vault';
  return 'device';
}

function kindLabel(path: TodoPathResponse): string {
  if (path.kind === 'url') return translateUi('Web');
  if (path.kind === 'vault') return 'vault';
  return path.host_label || translateUi('This device');
}

async function openPath(path: TodoPathResponse) {
  if (path.kind === 'url') {
    const url = /^https?:\/\//i.test(path.path) ? path.path : `https://${path.path}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (path.kind === 'vault') {
    window.open(`obsidian://open?file=${encodeURIComponent(path.path)}`, '_blank');
    return;
  }
  try {
    await navigator.clipboard.writeText(path.path);
    useToastStore.getState().addToast('success', translateUi('Path copied'));
  } catch {
    useToastStore.getState().addToast('error', path.path);
  }
}

/**
 * Where the task's material lives. A step shows its parent's paths dimmed,
 * and a top-level task its project's folders, so they are not typed twice.
 */
export default function TaskPaths({ taskId }: { taskId: string }) {
  const { data: paths = [] } = useTodoPathsQuery(taskId);
  const addPath = useAddTodoPath(taskId);
  const deletePath = useDeleteTodoPath(taskId);
  const { isDesktop } = usePlatform();
  const thisHostId = useWorkerStore((state) => state.hostId);
  const [draft, setDraft] = useState('');

  const add = (value: string, kind: TodoPathKind = detectPathKind(value)) => {
    const path = value.trim();
    if (!path) return;
    addPath.mutate({ kind, path, host_id: kind === 'device' ? thisHostId : null });
    setDraft('');
  };

  const browse = async () => {
    try {
      const folder = await platformApi.server.selectFolder();
      if (folder) add(folder, 'device');
    } catch {
      // The picker was closed or is unavailable; the text field still works.
    }
  };

  return (
    <section className="cc-task-paths" aria-label={translateUi('Paths')}>
      <div className="cc-exec-panel__section-title">{translateUi('Paths')}</div>
      {paths.length > 0 && (
        <ul className="cc-task-paths__list">
          {paths.map((path) => (
            <li
              key={`${path.inherited ? 'inherited' : 'own'}:${path.id}`}
              className={path.inherited ? 'cc-task-paths__item--inherited' : undefined}
            >
              <span className="cc-task-paths__kind">{kindLabel(path)}</span>
              <button
                type="button"
                className="cc-task-paths__path"
                title={path.path}
                onClick={() => void openPath(path)}
              >
                {path.label || path.path}
              </button>
              {!path.inherited && (
                <button
                  type="button"
                  className="cc-btn cc-btn--ghost cc-btn--compact"
                  aria-label={translateUi('Remove')}
                  onClick={() => deletePath.mutate(path)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="cc-task-paths__add">
        <input
          className="cc-settings-input"
          value={draft}
          placeholder={translateUi('Paste a path or URL')}
          aria-label={translateUi('Paste a path or URL')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              add(draft);
            }
          }}
        />
        {isDesktop && thisHostId && (
          <button type="button" className="cc-btn cc-btn--compact" onClick={() => void browse()}>
            {translateUi('Browse…')}
          </button>
        )}
      </div>
    </section>
  );
}
