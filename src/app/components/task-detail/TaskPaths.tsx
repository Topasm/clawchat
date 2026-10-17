import { useState } from 'react';
import {
  useAddTodoPath,
  useAttachmentsQuery,
  useDeleteAttachment,
  useDeleteTodoPath,
  useTodoPathsQuery,
} from '../../hooks/queries';
import type { TodoPathKind, TodoPathResponse } from '../../types/api';
import type { AttachmentResponse } from '../../types/schemas';
import usePlatform from '../../hooks/usePlatform';
import { platformApi } from '../../platform';
import { useAuthStore } from '../../stores/useAuthStore';
import { useWorkerStore } from '../../stores/useWorkerStore';
import { useToastStore } from '../../stores/useToastStore';
import { translateUi } from '../../i18n';
import ConfirmDialog from '../shared/ConfirmDialog';
import FileDropZone, { useAttachmentUploader } from '../shared/FileDropZone';

/** Decide a pasted string's kind from its shape: a URL, a vault note, or a folder. */
export function detectPathKind(text: string): TodoPathKind {
  const value = text.trim();
  if (/^(https?:\/\/|www\.)/i.test(value)) return 'url';
  if (/^(\/|~|[A-Za-z]:[\\/])/.test(value)) return 'device';
  if (/\.md$/i.test(value)) return 'vault';
  return 'device';
}

/** The row's first word says what kind of thing it points at, never where. */
function kindLabel(path: TodoPathResponse): string {
  if (path.kind === 'url') return translateUi('Web');
  if (path.kind === 'vault') return translateUi('Note');
  return translateUi('Folder');
}

/** A folder on a named machine says so; one with no machine is this device's. */
function whereHint(path: TodoPathResponse, thisHostId: string | null): string | null {
  if (path.kind !== 'device') return null;
  if (path.host_id && thisHostId && path.host_id === thisHostId) return null;
  return path.host_label ? translateUi('On {{host}}', { host: path.host_label }) : null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
 * Everything a task's work refers to, in one list: folders and notes by
 * path, web links, and files uploaded to Home (a photo from the phone's
 * share sheet has no path anywhere). Every row starts with its kind in
 * words, so an uploaded copy and a path that only points somewhere are never
 * confused. The task's own rows come first; what a step inherits from its
 * parent, or a top-level task from its project, sits dimmed at the bottom,
 * so nothing is typed twice. Taking an uploaded file off the list asks once,
 * since the copy on Home goes with it; a path is only taken off the list.
 */
export default function TaskPaths({ taskId }: { taskId: string }) {
  const { data: paths = [] } = useTodoPathsQuery(taskId);
  const { data: attachments = [] } = useAttachmentsQuery(taskId);
  const addPath = useAddTodoPath(taskId);
  const deletePath = useDeleteTodoPath(taskId);
  const deleteAttachment = useDeleteAttachment();
  const upload = useAttachmentUploader(taskId);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const { isDesktop } = usePlatform();
  const thisHostId = useWorkerStore((state) => state.hostId);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<AttachmentResponse | null>(null);
  const own = paths.filter((path) => !path.inherited);
  const inherited = paths.filter((path) => path.inherited);

  const openAttachment = (attachment: AttachmentResponse) => {
    const url = serverUrl ? `${serverUrl}${attachment.url}` : attachment.url;
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const removeAttachment = async (attachment: AttachmentResponse) => {
    setRemoving(null);
    try {
      await deleteAttachment.mutateAsync({ id: attachment.id, ownerId: taskId });
    } catch {
      useToastStore.getState().addToast('error', translateUi('Failed to delete attachment'));
    }
  };

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
    <section className="cc-task-paths" aria-label={translateUi('Resources')}>
      <div className="cc-exec-panel__section-title">{translateUi('Resources')}</div>
      {(paths.length > 0 || attachments.length > 0) && (
        <ul className="cc-task-paths__list">
          {own.map((path) => (
            <PathRow
              key={`own:${path.id}`}
              path={path}
              hint={whereHint(path, thisHostId)}
              onRemove={() => deletePath.mutate(path)}
            />
          ))}
          {attachments.map((attachment) => (
            <li key={`file:${attachment.id}`}>
              <span className="cc-task-paths__kind">{translateUi('File')}</span>
              <button
                type="button"
                className="cc-task-paths__path"
                title={attachment.filename}
                onClick={() => openAttachment(attachment)}
              >
                {attachment.filename}
              </button>
              <span className="cc-task-paths__size">{formatFileSize(attachment.size_bytes)}</span>
              <button
                type="button"
                className="cc-btn cc-btn--ghost cc-btn--compact"
                aria-label={translateUi('Remove {{filename}} from the list', {
                  filename: attachment.filename,
                })}
                onClick={() => setRemoving(attachment)}
              >
                ×
              </button>
            </li>
          ))}
          {inherited.map((path) => (
            <PathRow key={`inherited:${path.id}`} path={path} hint={whereHint(path, thisHostId)} />
          ))}
        </ul>
      )}
      <div className="cc-task-paths__add">
        <input
          className="cc-settings-input"
          value={draft}
          placeholder={translateUi('Paste a path, URL or file')}
          aria-label={translateUi('Paste a path, URL or file')}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            // A file on the clipboard (a screenshot, a copied document) is
            // uploaded; text falls through to the field as usual.
            const files = Array.from(event.clipboardData.files);
            if (files.length === 0) return;
            event.preventDefault();
            files.forEach((file) => void upload(file));
          }}
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
      <FileDropZone todoId={taskId} compact />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={translateUi('Remove this file?')}
        description={translateUi(
          'The uploaded copy of {{filename}} is deleted from Home. A path or note is only taken off the list.',
          { filename: removing?.filename ?? '' },
        )}
        confirmLabel={translateUi('Remove')}
        onConfirm={() => removing && void removeAttachment(removing)}
      />
    </section>
  );
}

/** One path: its kind, the path itself, where it lives, and a remove for the task's own. */
function PathRow({
  path,
  hint,
  onRemove,
}: {
  path: TodoPathResponse;
  hint: string | null;
  onRemove?: () => void;
}) {
  return (
    <li className={path.inherited ? 'cc-task-paths__item--inherited' : undefined}>
      <span className="cc-task-paths__kind">{kindLabel(path)}</span>
      <button
        type="button"
        className="cc-task-paths__path"
        title={path.path}
        onClick={() => void openPath(path)}
      >
        {path.label || path.path}
      </button>
      {hint && <span className="cc-task-paths__hint">{hint}</span>}
      {onRemove && (
        <button
          type="button"
          className="cc-btn cc-btn--ghost cc-btn--compact"
          aria-label={translateUi('Remove {{path}} from the list', {
            path: path.label || path.path,
          })}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </li>
  );
}
