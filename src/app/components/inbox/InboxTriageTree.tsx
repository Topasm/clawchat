import type { ProjectResponse, TodoResponse } from '../../types/api';

export const INBOX_TASK_DRAG_TYPE = 'application/x-clawchat-task-id';
export const INBOX_TASK_BATCH_DRAG_TYPE = 'application/x-clawchat-task-batch';
export const INBOX_DEPENDENCY_DRAG_TYPE = 'application/x-clawchat-task-dependency';

interface InboxTriageTreeProps {
  projects: ProjectResponse[];
  todos: TodoResponse[];
  selectedTaskId: string | null;
  batchTaskIds: string[];
  disabled: boolean;
  onSelectTask: (taskId: string) => void;
  onPlace: (taskId: string, projectId: string, parentId: string | null, beforeId?: string) => void;
  onPlaceBatch: (
    taskIds: string[],
    projectId: string,
    parentId: string | null,
    beforeId?: string,
  ) => void;
  onPreviewDependency: (dependentTaskId: string, prerequisiteTaskId: string) => void;
}

function sorted(items: TodoResponse[]) {
  return [...items].sort(
    (left, right) =>
      (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.title.localeCompare(right.title),
  );
}

function draggedTaskId(event: React.DragEvent): string | null {
  return event.dataTransfer.getData(INBOX_TASK_DRAG_TYPE) || null;
}

function draggedPlacementTaskIds(event: React.DragEvent): string[] {
  const batch = event.dataTransfer.getData(INBOX_TASK_BATCH_DRAG_TYPE);
  if (batch) {
    try {
      const parsed: unknown = JSON.parse(batch);
      if (Array.isArray(parsed) && parsed.every((taskId) => typeof taskId === 'string')) {
        return parsed;
      }
    } catch {
      return [];
    }
  }
  const taskId = draggedTaskId(event);
  return taskId ? [taskId] : [];
}

function acceptsPlacementDrag(event: React.DragEvent): boolean {
  return (
    acceptsDragType(event, INBOX_TASK_DRAG_TYPE) ||
    acceptsDragType(event, INBOX_TASK_BATCH_DRAG_TYPE)
  );
}

function acceptsDragType(event: React.DragEvent, type: string): boolean {
  return (
    Array.from(event.dataTransfer.types ?? []).includes(type) ||
    Boolean(event.dataTransfer.getData(type))
  );
}

function draggedDependencyTaskId(event: React.DragEvent): string | null {
  return event.dataTransfer.getData(INBOX_DEPENDENCY_DRAG_TYPE) || null;
}

export default function InboxTriageTree({
  projects,
  todos,
  selectedTaskId,
  batchTaskIds,
  disabled,
  onSelectTask,
  onPlace,
  onPlaceBatch,
  onPreviewDependency,
}: InboxTriageTreeProps) {
  const projectRoots = new Set(projects.flatMap((project) => project.root_task_id ?? []));

  return (
    <section className="cc-inbox-tree" aria-label="Project work tree">
      <header className="cc-inbox-tree__header">
        <div>
          <strong>Project / Work Tree</strong>
          <span>
            {batchTaskIds.length > 1
              ? `${batchTaskIds.length} tasks selected for one atomic move`
              : 'Drop a card to place the same task'}
          </span>
        </div>
      </header>
      <div className="cc-inbox-tree__projects">
        {projects.map((project) => {
          const projectTasks = todos.filter(
            (todo) => todo.project_id === project.id && !projectRoots.has(todo.id),
          );
          const childrenByParent = new Map<string | null, TodoResponse[]>();
          projectTasks.forEach((task) => {
            const parentId = task.parent_id ?? null;
            childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), task]);
          });
          const roots = sorted(
            [
              ...(childrenByParent.get(null) ?? []),
              ...(project.root_task_id ? (childrenByParent.get(project.root_task_id) ?? []) : []),
            ].filter(
              (task, index, items) =>
                items.findIndex((candidate) => candidate.id === task.id) === index,
            ),
          );
          return (
            <div key={project.id} className="cc-inbox-tree__project">
              <div
                className="cc-inbox-tree__project-target"
                onDragOver={(event) => {
                  if (!disabled && acceptsPlacementDrag(event)) {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => {
                  const taskIds = draggedPlacementTaskIds(event);
                  if (taskIds.length && !disabled) {
                    event.preventDefault();
                    if (taskIds.length > 1) onPlaceBatch(taskIds, project.id, null);
                    else onPlace(taskIds[0], project.id, null);
                  }
                }}
              >
                <strong>{project.title}</strong>
                <span>{project.task_count} tasks</span>
                {(selectedTaskId || batchTaskIds.length > 1) && (
                  <button
                    type="button"
                    aria-label={
                      batchTaskIds.length > 1
                        ? `Place ${batchTaskIds.length} selected tasks in ${project.title}`
                        : `Place selected task in ${project.title}`
                    }
                    disabled={disabled}
                    onClick={() => {
                      if (batchTaskIds.length > 1) {
                        onPlaceBatch(batchTaskIds, project.id, null);
                      } else if (selectedTaskId) {
                        onPlace(selectedTaskId, project.id, null);
                      }
                    }}
                  >
                    Place here
                  </button>
                )}
              </div>
              <div className="cc-inbox-tree__nodes">
                {roots.length === 0 ? (
                  <span className="cc-inbox-tree__empty">Drop here to start this project</span>
                ) : (
                  roots.map((task) => (
                    <TreeNode
                      key={task.id}
                      task={task}
                      projectId={project.id}
                      childrenByParent={childrenByParent}
                      depth={0}
                      selectedTaskId={selectedTaskId}
                      batchTaskIds={batchTaskIds}
                      disabled={disabled}
                      onSelectTask={onSelectTask}
                      onPlace={onPlace}
                      onPlaceBatch={onPlaceBatch}
                      onPreviewDependency={onPreviewDependency}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
        {projects.length === 0 && (
          <div className="cc-inbox-tree__empty">Create a project before placing Inbox tasks.</div>
        )}
      </div>
    </section>
  );
}

function TreeNode({
  task,
  projectId,
  childrenByParent,
  depth,
  selectedTaskId,
  batchTaskIds,
  disabled,
  onSelectTask,
  onPlace,
  onPlaceBatch,
  onPreviewDependency,
}: {
  task: TodoResponse;
  projectId: string;
  childrenByParent: Map<string | null, TodoResponse[]>;
  depth: number;
  selectedTaskId: string | null;
  batchTaskIds: string[];
  disabled: boolean;
  onSelectTask: (taskId: string) => void;
  onPlace: (taskId: string, projectId: string, parentId: string | null, beforeId?: string) => void;
  onPlaceBatch: (
    taskIds: string[],
    projectId: string,
    parentId: string | null,
    beforeId?: string,
  ) => void;
  onPreviewDependency: (dependentTaskId: string, prerequisiteTaskId: string) => void;
}) {
  const children = sorted(childrenByParent.get(task.id) ?? []);
  return (
    <div className="cc-inbox-tree__branch">
      <div
        className="cc-inbox-tree__insert"
        style={{ marginLeft: depth * 18 }}
        onDragOver={(event) => {
          if (!disabled && acceptsPlacementDrag(event)) event.preventDefault();
        }}
        onDrop={(event) => {
          const taskIds = draggedPlacementTaskIds(event);
          if (taskIds.length && !taskIds.includes(task.id) && !disabled) {
            event.preventDefault();
            if (taskIds.length > 1) {
              onPlaceBatch(taskIds, projectId, task.parent_id ?? null, task.id);
            } else {
              onPlace(taskIds[0], projectId, task.parent_id ?? null, task.id);
            }
          }
        }}
      />
      <div
        className={`cc-inbox-tree__node${selectedTaskId === task.id ? ' cc-inbox-tree__node--selected' : ''}`}
        style={{ marginLeft: depth * 18 }}
        draggable={!disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData(INBOX_TASK_DRAG_TYPE, task.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (!disabled && acceptsPlacementDrag(event)) event.preventDefault();
        }}
        onDrop={(event) => {
          const taskIds = draggedPlacementTaskIds(event);
          if (taskIds.length && !taskIds.includes(task.id) && !disabled) {
            event.preventDefault();
            event.stopPropagation();
            if (taskIds.length > 1) onPlaceBatch(taskIds, projectId, task.id);
            else onPlace(taskIds[0], projectId, task.id);
          }
        }}
      >
        <button type="button" onClick={() => onSelectTask(task.id)}>
          <span>{children.length ? '▾' : '•'}</span>
          <strong>{task.title}</strong>
          <small>{task.status.replace('_', ' ')}</small>
        </button>
        <button
          type="button"
          className="cc-inbox-tree__dependency-handle"
          aria-label={`Dependency connector for ${task.title}. Drag to a prerequisite or drop a dependent here.`}
          title={
            selectedTaskId && selectedTaskId !== task.id
              ? `Make selected task wait for ${task.title}`
              : 'Drag to the task that must finish first'
          }
          draggable={!disabled}
          disabled={disabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (selectedTaskId && selectedTaskId !== task.id) {
              onPreviewDependency(selectedTaskId, task.id);
            }
          }}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.setData(INBOX_DEPENDENCY_DRAG_TYPE, task.id);
            event.dataTransfer.effectAllowed = 'link';
          }}
          onDragOver={(event) => {
            if (!disabled && acceptsDragType(event, INBOX_DEPENDENCY_DRAG_TYPE)) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'link';
            }
          }}
          onDrop={(event) => {
            const dependentTaskId = draggedDependencyTaskId(event);
            if (dependentTaskId && dependentTaskId !== task.id && !disabled) {
              event.preventDefault();
              event.stopPropagation();
              onPreviewDependency(dependentTaskId, task.id);
            }
          }}
        >
          <span aria-hidden="true">↝</span>
        </button>
        {(batchTaskIds.length > 1
          ? !batchTaskIds.includes(task.id)
          : selectedTaskId && selectedTaskId !== task.id) && (
          <div className="cc-inbox-tree__placement-actions">
            <button
              type="button"
              className="cc-inbox-tree__place-button"
              aria-label={
                batchTaskIds.length > 1
                  ? `Place ${batchTaskIds.length} selected tasks before ${task.title}`
                  : `Place selected task before ${task.title}`
              }
              disabled={disabled}
              onClick={() => {
                if (batchTaskIds.length > 1) {
                  onPlaceBatch(batchTaskIds, projectId, task.parent_id ?? null, task.id);
                } else if (selectedTaskId) {
                  onPlace(selectedTaskId, projectId, task.parent_id ?? null, task.id);
                }
              }}
            >
              Before
            </button>
            <button
              type="button"
              className="cc-inbox-tree__place-button"
              aria-label={
                batchTaskIds.length > 1
                  ? `Place ${batchTaskIds.length} selected tasks under ${task.title}`
                  : `Place selected task under ${task.title}`
              }
              disabled={disabled}
              onClick={() => {
                if (batchTaskIds.length > 1) {
                  onPlaceBatch(batchTaskIds, projectId, task.id);
                } else if (selectedTaskId) {
                  onPlace(selectedTaskId, projectId, task.id);
                }
              }}
            >
              Under
            </button>
          </div>
        )}
      </div>
      {children.map((child) => (
        <TreeNode
          key={child.id}
          task={child}
          projectId={projectId}
          childrenByParent={childrenByParent}
          depth={depth + 1}
          selectedTaskId={selectedTaskId}
          batchTaskIds={batchTaskIds}
          disabled={disabled}
          onSelectTask={onSelectTask}
          onPlace={onPlace}
          onPlaceBatch={onPlaceBatch}
          onPreviewDependency={onPreviewDependency}
        />
      ))}
    </div>
  );
}
