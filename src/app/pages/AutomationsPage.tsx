import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ScheduledJobEditor from '../components/automations/ScheduledJobEditor';
import { describeSchedule } from '../components/automations/scheduleText';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import EmptyState from '../components/shared/EmptyState';
import { RepeatIcon } from '../components/shared/Icons';
import {
  useCreateScheduledJob,
  useDeleteScheduledJob,
  useRunScheduledJobNow,
  useScheduledJobsQuery,
  useUpdateScheduledJob,
} from '../hooks/queries';
import { translateUi } from '../i18n';
import { localTimeZone } from '../services/jobSchedule';
import type { ScheduledJob } from '../types/schemas';
import { formatDateTime } from '../utils/formatters';

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  starting: 'Starting',
  running: 'Running',
  waiting_input: 'Needs your input',
  waiting_review: 'Ready for review',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function JobCard({
  job,
  onEdit,
  onDelete,
}: {
  job: ScheduledJob;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const update = useUpdateScheduledJob();
  const runNow = useRunScheduledJobNow();
  const zoneNote = job.timezone !== localTimeZone() ? ` (${job.timezone})` : '';

  return (
    <article className={`cc-card cc-job-card${job.enabled ? '' : ' cc-job-card--paused'}`}>
      <header className="cc-job-card__header">
        <h2 className="cc-job-card__title">{job.title}</h2>
        {!job.enabled && <span className="cc-job-card__badge">{translateUi('Paused')}</span>}
      </header>
      <p className="cc-job-card__meta">
        {describeSchedule(job.rrule)}
        {zoneNote}
        {' · '}
        {job.project_title ?? translateUi('All tasks')}
      </p>
      <p className="cc-job-card__instruction">{job.instruction}</p>
      <dl className="cc-job-card__facts">
        <div>
          <dt>{translateUi('Next run')}</dt>
          <dd>
            {job.enabled && job.next_run_at
              ? formatDateTime(job.next_run_at)
              : translateUi('Not scheduled')}
          </dd>
        </div>
        <div>
          <dt>{translateUi('Last run')}</dt>
          <dd>
            {job.last_run_at
              ? `${formatDateTime(job.last_run_at)}${
                  job.last_run_status
                    ? ` · ${translateUi(RUN_STATUS_LABELS[job.last_run_status] ?? job.last_run_status)}`
                    : ''
                }`
              : translateUi('Never')}
          </dd>
        </div>
      </dl>
      {job.last_error && (
        <p className="cc-job-card__error" role="status">
          {translateUi('Last attempt did not start: {{reason}}', { reason: job.last_error })}
        </p>
      )}
      <div className="cc-job-card__actions">
        <button
          type="button"
          className="cc-btn cc-btn--primary cc-btn--small"
          disabled={runNow.isPending}
          onClick={() => runNow.mutate(job.id)}
        >
          {translateUi('Run now')}
        </button>
        {job.conversation_id && (
          <button
            type="button"
            className="cc-btn cc-btn--small"
            onClick={() => navigate(`/chats/${job.conversation_id}`)}
          >
            {translateUi('Open thread')}
          </button>
        )}
        <button
          type="button"
          className="cc-btn cc-btn--small"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: job.id, changes: { enabled: !job.enabled } })}
        >
          {job.enabled ? translateUi('Pause') : translateUi('Resume')}
        </button>
        <button type="button" className="cc-btn cc-btn--small" onClick={onEdit}>
          {translateUi('Edit')}
        </button>
        <button type="button" className="cc-btn cc-btn--danger cc-btn--small" onClick={onDelete}>
          {translateUi('Delete')}
        </button>
      </div>
    </article>
  );
}

/**
 * Standing instructions the server runs on a schedule, over the user's tasks.
 *
 * Each run is an ordinary agent run: it posts to the job's thread and its
 * result waits in Attention, so this page only manages the schedules.
 */
export default function AutomationsPage() {
  const { data: jobs = [], isLoading } = useScheduledJobsQuery();
  const create = useCreateScheduledJob();
  const update = useUpdateScheduledJob();
  const remove = useDeleteScheduledJob();
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [deleting, setDeleting] = useState<ScheduledJob | null>(null);

  return (
    <div className="cc-automations-page">
      <header className="cc-page-header cc-automations-page__header">
        <div>
          <h1 className="cc-page-header__title">{translateUi('Automations')}</h1>
          <p className="cc-page-header__subtitle">
            {translateUi(
              'Jobs that run on a schedule over your tasks. Results arrive in Attention for review.',
            )}
          </p>
        </div>
        <div className="cc-page-header__actions">
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={editing === 'new'}
            onClick={() => setEditing('new')}
          >
            {translateUi('New job')}
          </button>
        </div>
      </header>

      {editing === 'new' && (
        <ScheduledJobEditor
          saving={create.isPending}
          onCancel={() => setEditing(null)}
          onSave={(input) => create.mutate(input, { onSuccess: () => setEditing(null) })}
        />
      )}

      {isLoading ? (
        <div className="cc-project-workspace__loading">{translateUi('Loading…')}</div>
      ) : jobs.length === 0 && editing !== 'new' ? (
        <EmptyState
          icon={<RepeatIcon size={28} />}
          message={translateUi(
            'No scheduled jobs yet. Try a weekly status update or an evening check of what is blocked.',
          )}
        />
      ) : (
        <div className="cc-automations-page__list">
          {jobs.map((job) =>
            editing === job.id ? (
              <ScheduledJobEditor
                key={job.id}
                job={job}
                saving={update.isPending}
                onCancel={() => setEditing(null)}
                onSave={(changes) =>
                  update.mutate({ id: job.id, changes }, { onSuccess: () => setEditing(null) })
                }
              />
            ) : (
              <JobCard
                key={job.id}
                job={job}
                onEdit={() => setEditing(job.id)}
                onDelete={() => setDeleting(job)}
              />
            ),
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={translateUi('Delete scheduled job?')}
        description={translateUi(
          'It stops running. Its thread and past results stay where they are.',
        )}
        confirmLabel={translateUi('Delete')}
        cancelLabel={translateUi('Cancel')}
        danger
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
