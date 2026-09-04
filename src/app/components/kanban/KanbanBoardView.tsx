import type { ReactNode } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import type { TaskStatus, TodoResponse } from '../../types/api';
import KanbanColumn from './KanbanColumn';
import KanbanColumnTabs from './KanbanColumnTabs';
import KanbanFilterBar from './KanbanFilterBar';
import BulkActionToolbar from './BulkActionToolbar';
import TasksHeader, { type TasksStatusFilter, type TasksViewMode } from './TasksHeader';

interface ColumnDef {
  status: TaskStatus;
  title: string;
  icon: ReactNode;
  tasks: TodoResponse[];
}

interface KanbanBoardViewProps {
  todos: TodoResponse[];
  viewMode: TasksViewMode;
  onViewModeChange: (mode: TasksViewMode) => void;
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
  columnDefs: ColumnDef[];
  showSubTasks: boolean;
  isMobile: boolean;
  onDragStart: () => void;
  onDragEnd: (result: DropResult) => void;
  onToggle: (id: string) => void;
  onClickTask: (id: string) => void;
  focusedTaskId: string | null;
  onFocusTask: (id: string | null) => void;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  isMultiSelectMode: boolean;
  onMove: (id: string, status: TaskStatus) => void;
  onDelete?: (id: string) => void;
}

export default function KanbanBoardView({
  todos,
  viewMode,
  onViewModeChange,
  statusFilter,
  onStatusFilterChange,
  columnDefs,
  showSubTasks,
  isMobile,
  onDragStart,
  onDragEnd,
  onToggle,
  onClickTask,
  focusedTaskId,
  onFocusTask,
  selectedIds,
  onSelect,
  isMultiSelectMode,
  onMove,
  onDelete,
}: KanbanBoardViewProps) {
  return (
    <div>
      <TasksHeader
        todos={todos}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
      />
      <KanbanFilterBar />
      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {isMobile ? (
          <KanbanColumnTabs
            columns={columnDefs}
            allTodos={todos}
            showSubTasks={showSubTasks}
            onToggle={onToggle}
            onClickTask={onClickTask}
            focusedTaskId={focusedTaskId}
            onFocusTask={onFocusTask}
            selectedIds={selectedIds}
            onSelect={onSelect}
            isMultiSelectMode={isMultiSelectMode}
            onMove={onMove}
            onComplete={onToggle}
            onDelete={onDelete}
          />
        ) : (
          <div className="cc-kanban">
            {columnDefs.map((col) => (
              <KanbanColumn
                key={col.status}
                status={col.status}
                title={col.title}
                icon={col.icon}
                tasks={col.tasks}
                allTodos={todos}
                showSubTasks={showSubTasks}
                onToggle={onToggle}
                onClickTask={onClickTask}
                focusedTaskId={focusedTaskId}
                onFocusTask={onFocusTask}
                selectedIds={selectedIds}
                onSelect={onSelect}
                isMultiSelectMode={isMultiSelectMode}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </DragDropContext>
      <BulkActionToolbar />
    </div>
  );
}
