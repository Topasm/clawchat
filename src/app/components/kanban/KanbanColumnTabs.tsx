import { useState, useRef, useCallback } from 'react';
import type { TodoResponse, KanbanStatus } from '../../types/api';
import KanbanColumn from './KanbanColumn';

interface ColumnDef {
  status: KanbanStatus;
  title: string;
  icon: string;
  tasks: TodoResponse[];
}

interface KanbanColumnTabsProps {
  columns: ColumnDef[];
  allTodos: TodoResponse[];
  showSubTasks: boolean;
  onToggle: (id: string) => void;
  onClickTask: (id: string) => void;
  focusedTaskId: string | null;
  onFocusTask: (id: string) => void;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  isMultiSelectMode: boolean;
  onMove: (id: string, status: KanbanStatus) => void;
  onComplete: (id: string) => void;
}

const SWIPE_THRESHOLD = 50; // px delta-X to trigger tab switch

export default function KanbanColumnTabs({
  columns,
  allTodos,
  showSubTasks,
  onToggle,
  onClickTask,
  focusedTaskId,
  onFocusTask,
  selectedIds,
  onSelect,
  isMultiSelectMode,
  onMove,
  onComplete,
}: KanbanColumnTabsProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const touchStartX = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (dx < -SWIPE_THRESHOLD && activeIdx < columns.length - 1) {
        setActiveIdx(activeIdx + 1);
      } else if (dx > SWIPE_THRESHOLD && activeIdx > 0) {
        setActiveIdx(activeIdx - 1);
      }
    },
    [activeIdx, columns.length],
  );

  const active = columns[activeIdx];

  return (
    <div className="cc-kanban-tabs">
      <div className="cc-kanban-tabs__bar">
        {columns.map((col, i) => (
          <button
            key={col.status}
            className={`cc-kanban-tabs__tab${i === activeIdx ? ' cc-kanban-tabs__tab--active' : ''}`}
            onClick={() => setActiveIdx(i)}
          >
            {col.icon} {col.title}
            <span className="cc-kanban-tabs__count">{col.tasks.filter((t) => !t.parent_id).length}</span>
          </button>
        ))}
      </div>
      <div className="cc-kanban-tabs__content" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <KanbanColumn
          key={active.status}
          status={active.status}
          title={active.title}
          icon={active.icon}
          tasks={active.tasks}
          allTodos={allTodos}
          showSubTasks={showSubTasks}
          onToggle={onToggle}
          onClickTask={onClickTask}
          focusedTaskId={focusedTaskId}
          onFocusTask={onFocusTask}
          selectedIds={selectedIds}
          onSelect={onSelect}
          isMultiSelectMode={isMultiSelectMode}
          isMobile
          onMove={onMove}
          onComplete={onComplete}
        />
      </div>
    </div>
  );
}
