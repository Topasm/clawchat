import { useState, useRef, useCallback, useEffect } from 'react';
import type { TodoResponse } from '../../types/api';
import Checkbox from './Checkbox';
import Badge from './Badge';
const SKILL_BADGE_LABELS: Record<string, string> = {
  plan: 'Plan',
  research: 'Research',
  summarize: 'Sum',
  draft: 'Draft',
  code_review: 'Review',
  data_analysis: 'Analyze',
  obsidian_sync: 'Sync',
  prioritize: 'Priority',
};

interface TaskCardProps {
  task: TodoResponse;
  onToggle: () => void;
  onClick: () => void;
  onDelete?: () => void;
  className?: string;
  isSubTask?: boolean;
  subTaskCount?: number;
  isCompletedOverride?: boolean;
}

export default function TaskCard({ task, onToggle, onClick, onDelete, className, isSubTask, subTaskCount, isCompletedOverride }: TaskCardProps) {
  const isCompleted = isCompletedOverride ?? (task.status === 'completed');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onDelete) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }, [onDelete]);

  const handleTouchStart = useCallback(() => {
    if (!onDelete) return;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setMenu({ x: -1, y: -1 }); // -1 signals centered menu on mobile
    }, 500);
  }, [onDelete]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenu(null);
    setConfirmDelete(true);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    onDelete?.();
  };

  return (
    <>
      <div
        className={`cc-card cc-card--task${className ? ' ' + className : ''}${isSubTask ? ' cc-kanban__card--subtask' : ''}`}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        <Checkbox checked={isCompleted} onChange={onToggle} />
        <div className="cc-card__body">
          <div className={`cc-card__title${isCompleted ? ' cc-card__title--completed' : ''}`}>
            {task.title}
            {task.source === 'obsidian' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: 6, padding: '1px 5px', fontSize: 10, fontWeight: 700, lineHeight: '16px', borderRadius: 4, backgroundColor: '#7C3AED', color: '#fff', verticalAlign: 'middle' }}>OB</span>
            )}
          </div>
          <div className="cc-card__meta">
            {task.is_recurring && (
              <span title="Recurring" style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 5px', fontSize: 10, fontWeight: 700, lineHeight: '16px', borderRadius: 4, backgroundColor: 'var(--cc-color-info, #3B82F6)', color: '#fff' }}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}>
                  <path d="M1 4v6h6" /><path d="M3.51 14.49A8 8 0 0 0 15 8" /><path d="M15 12V6H9" /><path d="M12.49 1.51A8 8 0 0 0 1 8" />
                </svg>
              </span>
            )}
            {task.priority && task.priority !== 'medium' && (
              <Badge variant="priority" level={task.priority} />
            )}
            {task.due_date && (
              <Badge variant="due" dueDate={task.due_date} />
            )}
            {task.tags?.map((tag) => (
              <Badge key={tag} variant="tag">{tag}</Badge>
            ))}
            {task.enabled_skills?.length ? (
              task.enabled_skills.map((s) => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 5px', fontSize: 10, fontWeight: 700, lineHeight: '16px', borderRadius: 4, backgroundColor: '#6366F1', color: '#fff' }}>
                  {SKILL_BADGE_LABELS[s] || s}
                </span>
              ))
            ) : task.assignee && ['openclaw', 'planner', 'researcher', 'executor'].includes(task.assignee) ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 5px', fontSize: 10, fontWeight: 700, lineHeight: '16px', borderRadius: 4, backgroundColor: '#6366F1', color: '#fff' }}>
                {task.assignee === 'openclaw' ? 'AI' : task.assignee === 'planner' ? 'Plan' : task.assignee === 'researcher' ? 'Research' : 'Exec'}
              </span>
            ) : null}
            {(task.depends_on?.length ?? 0) > 0 && (
              <span className="cc-badge cc-badge--blocker" title={`Depends on ${task.depends_on!.length} task(s)`}>
                {task.depends_on!.length} dep{task.depends_on!.length !== 1 ? 's' : ''}
              </span>
            )}
            {(subTaskCount ?? 0) > 0 && (
              <span className="cc-badge cc-badge--count">{subTaskCount} sub-task{subTaskCount !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {menu && (
        <div
          ref={menuRef}
          className="cc-context-menu"
          style={menu.x >= 0
            ? { position: 'fixed', top: menu.y, left: menu.x, zIndex: 9999 }
            : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 9999 }
          }
        >
          <button className="cc-context-menu__item cc-context-menu__item--danger" onClick={handleDeleteClick}>
            Delete
          </button>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDelete && (
        <div className="cc-modal-overlay" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}>
          <div className="cc-modal cc-modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="cc-dialog__title">Delete Task</div>
            <p className="cc-dialog__description">Delete "{task.title}"? This cannot be undone.</p>
            <div className="cc-dialog__actions">
              <button className="cc-btn cc-btn--secondary" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}>Cancel</button>
              <button className="cc-btn cc-btn--danger" onClick={handleConfirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
