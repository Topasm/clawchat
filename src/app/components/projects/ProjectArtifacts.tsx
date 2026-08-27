import { useState } from 'react';
import type { FormEvent } from 'react';
import Dialog from '../shared/Dialog';
import EmptyState from '../shared/EmptyState';
import { MemoIcon } from '../shared/Icons';
import {
  useArtifactsQuery,
  useCreateArtifact,
  useProposeArtifactRevision,
} from '../../hooks/queries';
import type { ArtifactResponse, ArtifactType } from '../../types/api';

const TYPES: Array<{ value: ArtifactType; label: string }> = [
  { value: 'project_brief', label: 'Project brief' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'acceptance_criteria', label: 'Acceptance criteria' },
  { value: 'research_note', label: 'Research note' },
  { value: 'decision', label: 'Decision' },
  { value: 'report', label: 'Report' },
  { value: 'external_link', label: 'External link' },
];

export default function ProjectArtifacts({ projectId }: { projectId: string }) {
  const { data: artifacts = [], isLoading } = useArtifactsQuery(projectId);
  const createArtifact = useCreateArtifact(projectId);
  const proposeRevision = useProposeArtifactRevision(projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ArtifactResponse | null>(null);
  const [type, setType] = useState<ArtifactType>('project_brief');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const resetCreate = () => {
    setType('project_brief');
    setTitle('');
    setContent('');
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    await createArtifact.mutateAsync({ type, title: title.trim(), content });
    setCreateOpen(false);
    resetCreate();
  };

  const submitRevision = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    await proposeRevision.mutateAsync({
      artifactId: editing.id,
      title: title.trim(),
      content,
    });
    setEditing(null);
    resetCreate();
  };

  const openRevision = (artifact: ArtifactResponse) => {
    setEditing(artifact);
    setTitle(artifact.title);
    setContent(artifact.content);
  };

  return (
    <section className="cc-project-workspace__section">
      <div className="cc-project-workspace__section-header">
        <div>
          <h2>Artifacts</h2>
          <p>Durable project context with reviewed version history.</p>
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          onClick={() => setCreateOpen(true)}
        >
          New artifact
        </button>
      </div>
      {isLoading ? (
        <div className="cc-project-workspace__loading">Loading artifacts…</div>
      ) : artifacts.length === 0 ? (
        <EmptyState
          icon={<MemoIcon size={28} />}
          message="Create a brief, requirements, decision, or report for this project."
        />
      ) : (
        <div className="cc-artifact-grid">
          {artifacts.map((artifact) => (
            <article className="cc-artifact-card" key={artifact.id}>
              <div className="cc-artifact-card__meta">
                <span>{artifact.type.replaceAll('_', ' ')}</span>
                <span>v{artifact.current_version}</span>
              </div>
              <h3>{artifact.title}</h3>
              <pre>{artifact.content || 'No content yet.'}</pre>
              <div className="cc-artifact-card__footer">
                <span>Updated {new Date(artifact.updated_at).toLocaleDateString()}</span>
                <button type="button" className="cc-btn" onClick={() => openRevision(artifact)}>
                  Propose revision
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="New artifact">
        <form className="cc-project-form" onSubmit={submitCreate}>
          <label className="cc-project-form__field">
            <span>Type</span>
            <select value={type} onChange={(event) => setType(event.target.value as ArtifactType)}>
              {TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <ArtifactFields
            title={title}
            content={content}
            setTitle={setTitle}
            setContent={setContent}
          />
          <FormActions
            pending={createArtifact.isPending}
            submitLabel="Create artifact"
            onCancel={() => setCreateOpen(false)}
          />
        </form>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Propose artifact revision"
      >
        <form className="cc-project-form" onSubmit={submitRevision}>
          <p className="cc-artifact-dialog__hint">
            The current artifact stays unchanged until this revision is approved in Review.
          </p>
          <ArtifactFields
            title={title}
            content={content}
            setTitle={setTitle}
            setContent={setContent}
          />
          <FormActions
            pending={proposeRevision.isPending}
            submitLabel="Send to review"
            onCancel={() => setEditing(null)}
          />
        </form>
      </Dialog>
    </section>
  );
}

function ArtifactFields({
  title,
  content,
  setTitle,
  setContent,
}: {
  title: string;
  content: string;
  setTitle: (value: string) => void;
  setContent: (value: string) => void;
}) {
  return (
    <>
      <label className="cc-project-form__field">
        <span>Title</span>
        <input required value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="cc-project-form__field">
        <span>Content</span>
        <textarea
          required
          rows={12}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
    </>
  );
}

function FormActions({
  pending,
  submitLabel,
  onCancel,
}: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="cc-project-form__actions">
      <button type="button" className="cc-btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="cc-btn cc-btn--primary" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </div>
  );
}
