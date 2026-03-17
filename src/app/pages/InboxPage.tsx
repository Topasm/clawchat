import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import usePlatform from '../hooks/usePlatform';
import TaskCard from '../components/shared/TaskCard';
import SectionHeader from '../components/shared/SectionHeader';
import EmptyState from '../components/shared/EmptyState';
import { InboxTrayIcon } from '../components/shared/Icons';

export default function InboxPage() {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const { isMobile } = usePlatform();

  const handleToggle = (id: string) => {
    useModuleStore.getState().toggleTodoComplete(id).catch(() => {});
  };

  const inboxTasks = Array.isArray(todos)
    ? todos.filter((t) => !t.due_date && t.status !== 'completed')
    : [];

  // Group: root tasks first, sub-tasks indented under their parent
  const rootInboxTasks = inboxTasks.filter((t) => !t.parent_id);
  const childrenOf = (parentId: string) =>
    inboxTasks.filter((t) => t.parent_id === parentId);

  const totalItems = inboxTasks.length;

  return (
    <div>
      <div className="cc-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="cc-page-header__title">Inbox</div>
          <div className="cc-page-header__subtitle">
            {totalItems > 0
              ? `${totalItems} quick item${totalItems !== 1 ? 's' : ''}`
              : 'Capture first, organise later'}
          </div>
        </div>
        {!isMobile && (
          <button className="cc-btn cc-btn--primary" onClick={() => useQuickCaptureStore.getState().open()}>
            + New
          </button>
        )}
      </div>

      {/* Unscheduled tasks */}
      {inboxTasks.length > 0 && (
        <SectionHeader title="Needs organising" count={inboxTasks.length} variant="accent" defaultOpen>
          {rootInboxTasks.map((task) => (
            <div key={task.id}>
              <TaskCard
                task={task}
                onToggle={() => handleToggle(task.id)}
                onClick={() => navigate(`/tasks/${task.id}`)}
                subTaskCount={childrenOf(task.id).length}
              />
              {childrenOf(task.id).map((child) => (
                <TaskCard
                  key={child.id}
                  task={child}
                  onToggle={() => handleToggle(child.id)}
                  onClick={() => navigate(`/tasks/${child.id}`)}
                  isSubTask
                />
              ))}
            </div>
          ))}
        </SectionHeader>
      )}

      {totalItems === 0 && (
        <EmptyState icon={<InboxTrayIcon size={20} />} message={isMobile ? 'Inbox is clear. Add something when it comes up.' : 'Inbox is clear. Capture a task or note when something comes up.'} />
      )}
    </div>
  );
}
