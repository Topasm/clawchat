import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useToastStore } from '../stores/useToastStore';
import usePlatform from '../hooks/usePlatform';
import TaskCard from '../components/shared/TaskCard';
import SectionHeader from '../components/shared/SectionHeader';
import EmptyState from '../components/shared/EmptyState';
import { InboxTrayIcon } from '../components/shared/Icons';
import apiClient from '../services/apiClient';

export default function InboxPage() {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const { isMobile } = usePlatform();
  const addToast = useToastStore((s) => s.addToast);

  const handleToggle = (id: string) => {
    useModuleStore.getState().toggleTodoComplete(id).catch(() => {});
  };

  // Group by inbox_state
  const processing = todos.filter(
    (t) => t.inbox_state === 'classifying' || t.inbox_state === 'planning',
  );
  const planReady = todos.filter((t) => t.inbox_state === 'plan_ready');
  const errors = todos.filter((t) => t.inbox_state === 'error');
  const needsOrganising = todos.filter(
    (t) =>
      t.inbox_state === 'captured' ||
      ((!t.inbox_state || t.inbox_state === 'none') &&
        !t.due_date &&
        t.status !== 'completed' &&
        !t.parent_id),
  );

  const totalItems = processing.length + planReady.length + needsOrganising.length + errors.length;

  const handleOrganize = async (id: string) => {
    try {
      await apiClient.post(`/todos/${id}/organize`);
      addToast('info', 'Organizing...');
    } catch {
      addToast('error', 'Failed to organize');
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await apiClient.post(`/todos/${id}/organize`);
      addToast('info', 'Retrying...');
    } catch {
      addToast('error', 'Failed to retry');
    }
  };

  return (
    <div>
      <div
        className="cc-page-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div>
          <div className="cc-page-header__title">Inbox</div>
          <div className="cc-page-header__subtitle">
            {totalItems > 0
              ? `${totalItems} item${totalItems !== 1 ? 's' : ''}`
              : 'Capture first, organise later'}
          </div>
        </div>
        {!isMobile && (
          <button
            className="cc-btn cc-btn--primary"
            onClick={() => useQuickCaptureStore.getState().open()}
          >
            + New
          </button>
        )}
      </div>

      {/* Planning now (classifying/planning) */}
      {processing.length > 0 && (
        <SectionHeader title="Planning now" count={processing.length} variant="default" defaultOpen>
          {processing.map((task) => (
            <div key={task.id} className="cc-inbox-card cc-inbox-card--planning">
              <div className="cc-inbox-card__spinner" />
              <TaskCard
                task={task}
                onToggle={() => handleToggle(task.id)}
                onClick={() => navigate(`/tasks/${task.id}`)}
              />
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Review suggestion (plan_ready) */}
      {planReady.length > 0 && (
        <SectionHeader title="Review suggestion" count={planReady.length} variant="accent" defaultOpen>
          {planReady.map((task) => (
            <div key={task.id} className="cc-inbox-card cc-inbox-card--review">
              <TaskCard
                task={task}
                onToggle={() => handleToggle(task.id)}
                onClick={() => navigate(`/tasks/${task.id}`)}
              />
              <div className="cc-inbox-card__actions">
                <button
                  className="cc-btn cc-btn--primary"
                  style={{ fontSize: 12 }}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  Review
                </button>
              </div>
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Needs organizing (captured) */}
      {needsOrganising.length > 0 && (
        <SectionHeader
          title="Needs organizing"
          count={needsOrganising.length}
          variant="accent"
          defaultOpen
        >
          {needsOrganising.map((task) => {
            const children = todos.filter((t) => t.parent_id === task.id);
            return (
              <div key={task.id} className="cc-inbox-card">
                <TaskCard
                  task={task}
                  onToggle={() => handleToggle(task.id)}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                  subTaskCount={children.length}
                />
                <div className="cc-inbox-card__actions">
                  <button
                    className="cc-btn cc-btn--secondary"
                    style={{ fontSize: 12 }}
                    onClick={() => handleOrganize(task.id)}
                  >
                    Organize
                  </button>
                </div>
              </div>
            );
          })}
        </SectionHeader>
      )}

      {/* Failed (error) */}
      {errors.length > 0 && (
        <SectionHeader title="Failed" count={errors.length} variant="warning" defaultOpen={false}>
          {errors.map((task) => (
            <div key={task.id} className="cc-inbox-card cc-inbox-card--error">
              <TaskCard
                task={task}
                onToggle={() => handleToggle(task.id)}
                onClick={() => navigate(`/tasks/${task.id}`)}
              />
              <div className="cc-inbox-card__actions">
                <button
                  className="cc-btn cc-btn--danger"
                  style={{ fontSize: 12 }}
                  onClick={() => handleRetry(task.id)}
                >
                  Retry
                </button>
              </div>
            </div>
          ))}
        </SectionHeader>
      )}

      {totalItems === 0 && (
        <EmptyState
          icon={<InboxTrayIcon size={20} />}
          message={
            isMobile
              ? 'Inbox is clear. Add something when it comes up.'
              : 'Inbox is clear. Capture a task or note when something comes up.'
          }
        />
      )}
    </div>
  );
}
