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

  const handleApplyPlan = async (id: string) => {
    try {
      await apiClient.post(`/todos/${id}/plan/apply`);
      addToast('success', 'Plan applied');
      useModuleStore.getState().fetchTodos();
    } catch {
      addToast('error', 'Failed to apply plan');
    }
  };

  const handleDismissPlan = async (id: string) => {
    try {
      await apiClient.post(`/todos/${id}/plan/dismiss`);
      addToast('info', 'Plan dismissed');
      useModuleStore.getState().fetchTodos();
    } catch {
      addToast('error', 'Failed to dismiss plan');
    }
  };

  const renderTaskWithChildren = (task: typeof todos[0]) => {
    const children = todos.filter((t) => t.parent_id === task.id);
    return (
      <div key={task.id}>
        <TaskCard
          task={task}
          onToggle={() => handleToggle(task.id)}
          onClick={() => navigate(`/tasks/${task.id}`)}
          subTaskCount={children.length}
        />
        {children.map((child) => (
          <TaskCard
            key={child.id}
            task={child}
            onToggle={() => handleToggle(child.id)}
            onClick={() => navigate(`/tasks/${child.id}`)}
            isSubTask
          />
        ))}
      </div>
    );
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

      {/* Processing */}
      {processing.length > 0 && (
        <SectionHeader title="Processing" count={processing.length} variant="default" defaultOpen>
          {processing.map((task) => (
            <div key={task.id} style={{ opacity: 0.7 }}>
              <TaskCard
                task={task}
                onToggle={() => handleToggle(task.id)}
                onClick={() => navigate(`/tasks/${task.id}`)}
              />
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Plan ready */}
      {planReady.length > 0 && (
        <SectionHeader title="Plan ready" count={planReady.length} variant="accent" defaultOpen>
          {planReady.map((task) => (
            <div key={task.id}>
              {renderTaskWithChildren(task)}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '4px 0 12px 36px',
                }}
              >
                <button
                  className="cc-btn cc-btn--ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  View Plan
                </button>
                <button
                  className="cc-btn cc-btn--primary"
                  style={{ fontSize: 12 }}
                  onClick={() => handleApplyPlan(task.id)}
                >
                  Apply
                </button>
                <button
                  className="cc-btn cc-btn--ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => handleDismissPlan(task.id)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Needs organising */}
      {needsOrganising.length > 0 && (
        <SectionHeader
          title="Needs organising"
          count={needsOrganising.length}
          variant="accent"
          defaultOpen
        >
          {needsOrganising.map((task) => (
            <div key={task.id}>
              {renderTaskWithChildren(task)}
              <div style={{ padding: '2px 0 8px 36px' }}>
                <button
                  className="cc-btn cc-btn--ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => handleOrganize(task.id)}
                >
                  Organize
                </button>
              </div>
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <SectionHeader title="Errors" count={errors.length} variant="warning" defaultOpen={false}>
          {errors.map((task) => (
            <div key={task.id}>
              <TaskCard
                task={task}
                onToggle={() => handleToggle(task.id)}
                onClick={() => navigate(`/tasks/${task.id}`)}
              />
              <div style={{ padding: '2px 0 8px 36px' }}>
                <button
                  className="cc-btn cc-btn--ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => handleOrganize(task.id)}
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
