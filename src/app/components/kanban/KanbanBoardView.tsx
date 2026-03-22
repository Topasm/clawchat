import type { ReactNode } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import type { KanbanStatus, TodoResponse } from '../../types/api';
import KanbanColumn from './KanbanColumn';
import KanbanColumnTabs from './KanbanColumnTabs';
import KanbanFilterBar from './KanbanFilterBar';
import BulkActionToolbar from './BulkActionToolbar';

interface ColumnDef {
  status: KanbanStatus;
  title: string;
  icon: ReactNode;
  tasks: TodoResponse[];
}

interface KanbanBoardViewProps {
  todos: TodoResponse[];
  columnDefs: ColumnDef[];
  showSubTasks: boolean;
  isMobile: boolean;
  onDragStart: () => void;
  onDragEnd: (result: DropResult) => void;
  onToggle: (id: string) => void;
  onClickTask: (id: string) => void;
  onNewTask: () => void;
  focusedTaskId: string | null;
  onFocusTask: (id: string | null) => void;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  isMultiSelectMode: boolean;
  onMove: (id: string, status: KanbanStatus) => void;
  onDelete?: (id: string) => void;
}

export default function KanbanBoardView({
  todos,
  columnDefs,
  showSubTasks,
  isMobile,
  onDragStart,
  onDragEnd,
  onToggle,
  onClickTask,
  onNewTask,
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
      <div className="cc-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="cc-page-header__title">Tasks</div>
          <div className="cc-page-header__subtitle">
            {todos.length} task{todos.length !== 1 ? 's' : ''} organised by status
          </div>
        </div>
        {!isMobile && (
          <button className="cc-btn cc-btn--primary" onClick={onNewTask}>
            + New Task
          </button>
        )}
      </div>
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
