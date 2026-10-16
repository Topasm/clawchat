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
import FileDropZone, { useAttachmentUploader } from '../shared/FileDropZone';

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
 * share sheet has no path anywhere). A step shows its parent's paths dimmed,
 * and a top-level task its project's folders, so they are not typed twice.
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

  const openAttachment = (attachment: AttachmentResponse) => {
    const url = serverUrl ? `${serverUrl}${attachment.url}` : attachment.url;
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const removeAttachment = async (attachment: AttachmentResponse) => {
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
                aria-label={translateUi('Remove')}
                onClick={() => void removeAttachment(attachment)}
              >
                ×
              </button>
            </li>
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
    </section>
  );
}
