import { useState, Fragment } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import type { TodoResponse, KanbanStatus } from '../../types/api';
import KanbanCard from './KanbanCard';
import SwipeActions from './SwipeActions';
import EmptyState from '../shared/EmptyState';

interface KanbanColumnProps {
  status: KanbanStatus;
  title: string;
  icon: string;
  tasks: TodoResponse[];
  allTodos: TodoResponse[];
  showSubTasks: boolean;
  onToggle: (id: string) => void;
  onClickTask: (id: string) => void;
  focusedTaskId?: string | null;
  onFocusTask?: (id: string) => void;
  selectedIds?: Set<string>;
  onSelect?: (id: string) => void;
  isMultiSelectMode?: boolean;
  isMobile?: boolean;
  onMove?: (id: string, status: KanbanStatus) => void;
  onComplete?: (id: string) => void;
}

const variantMap: Record<KanbanStatus, string> = {
  pending: 'todo',
  in_progress: 'progress',
  completed: 'done',
};

export default function KanbanColumn({
  status,
  title,
  icon,
  tasks,
  allTodos,
  showSubTasks,
  onToggle,
  onClickTask,
  focusedTaskId,
  onFocusTask,
  selectedIds,
  onSelect,
  isMultiSelectMode,
  isMobile,
  onMove,
  onComplete,
}: KanbanColumnProps) {
  const variant = variantMap[status];
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Build render list: parent tasks, optionally with children inline
  const rootTasks = tasks.filter((t) => !t.parent_id);
  const getChildren = (parentId: string) => allTodos.filter((t) => t.parent_id === parentId);
  const getSubTaskCount = (parentId: string) => allTodos.filter((t) => t.parent_id === parentId).length;

  let draggableIndex = 0;

  const renderCard = (task: TodoResponse, idx: number, isSubTask?: boolean, subTaskCount?: number) => (
    <KanbanCard
      task={task}
      index={idx}
      onToggle={() => onToggle(task.id)}
      onClick={() => onClickTask(task.id)}
      isFocused={focusedTaskId === task.id}
      onFocus={() => onFocusTask?.(task.id)}
      isSelected={selectedIds?.has(task.id)}
      onSelect={() => onSelect?.(task.id)}
      onSelectTouch={onSelect}
      isSubTask={isSubTask}
      subTaskCount={subTaskCount}
      isDragDisabled={isMultiSelectMode}
      isMobile={isMobile}
    />
  );

  const wrapWithSwipe = (taskId: string, node: React.ReactNode) => {
    if (!isMobile || !onMove || !onComplete) return node;
    return (
      <SwipeActions taskId={taskId} currentStatus={status} onMove={onMove} onComplete={onComplete}>
        {node}
      </SwipeActions>
    );
  };

  return (
    <Droppable droppableId={status}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`cc-kanban__column cc-kanban__column--${variant}${snapshot.isDraggingOver ? ' cc-kanban__column--drag-over' : ''}`}
        >
          {/* Hide header on mobile — the tabs already show the column title */}
          {!isMobile && (
            <div className="cc-kanban__header">
              <span className="cc-kanban__header-icon">{icon}</span>
              <span className="cc-kanban__header-title">{title}</span>
              <span className="cc-kanban__header-count">{rootTasks.length}</span>
            </div>
          )}
          <div className="cc-kanban__cards">
            {rootTasks.length === 0 && !snapshot.isDraggingOver ? (
              <EmptyState icon="\uD83D\uDCCB" message={`No ${title.toLowerCase()} tasks`} />
            ) : (
              rootTasks.map((task) => {
                const idx = draggableIndex++;
                const childCount = getSubTaskCount(task.id);
                const isExpanded = expandedParents.has(task.id);
                const children = showSubTasks && isExpanded ? getChildren(task.id) : [];

                return (
                  <Fragment key={task.id}>
                    <div onClick={childCount > 0 && showSubTasks ? () => toggleExpand(task.id) : undefined}>
                      {wrapWithSwipe(task.id, renderCard(task, idx, undefined, childCount))}
                    </div>
                    {children.map((child) => {
                      const childIdx = draggableIndex++;
                      return (
                        <Fragment key={child.id}>
                          {wrapWithSwipe(child.id, renderCard(child, childIdx, true))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })
            )}
            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
}
