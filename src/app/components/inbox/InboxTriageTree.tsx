import type { ProjectResponse, TodoResponse } from '../../types/api';

export const INBOX_TASK_DRAG_TYPE = 'application/x-clawchat-task-id';

interface InboxTriageTreeProps {
  projects: ProjectResponse[];
  todos: TodoResponse[];
  selectedTaskId: string | null;
  disabled: boolean;
  onSelectTask: (taskId: string) => void;
  onPlace: (taskId: string, projectId: string, parentId: string | null, beforeId?: string) => void;
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

export default function InboxTriageTree({
  projects,
  todos,
  selectedTaskId,
  disabled,
  onSelectTask,
  onPlace,
}: InboxTriageTreeProps) {
  const projectRoots = new Set(projects.flatMap((project) => project.root_task_id ?? []));

  return (
    <section className="cc-inbox-tree" aria-label="Project work tree">
      <header className="cc-inbox-tree__header">
        <div>
          <strong>Project / Work Tree</strong>
          <span>Drop a card to place the same task</span>
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
                  if (!disabled) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const taskId = draggedTaskId(event);
                  if (taskId && !disabled) onPlace(taskId, project.id, null);
                }}
              >
                <strong>{project.title}</strong>
                <span>{project.task_count} tasks</span>
                {selectedTaskId && (
                  <button
                    type="button"
                    aria-label={`Place selected task in ${project.title}`}
                    disabled={disabled}
                    onClick={() => onPlace(selectedTaskId, project.id, null)}
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
                      disabled={disabled}
                      onSelectTask={onSelectTask}
                      onPlace={onPlace}
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
  disabled,
  onSelectTask,
  onPlace,
}: {
  task: TodoResponse;
  projectId: string;
  childrenByParent: Map<string | null, TodoResponse[]>;
  depth: number;
  selectedTaskId: string | null;
  disabled: boolean;
  onSelectTask: (taskId: string) => void;
  onPlace: (taskId: string, projectId: string, parentId: string | null, beforeId?: string) => void;
}) {
  const children = sorted(childrenByParent.get(task.id) ?? []);
  return (
    <div className="cc-inbox-tree__branch">
      <div
        className="cc-inbox-tree__insert"
        style={{ marginLeft: depth * 18 }}
        onDragOver={(event) => {
          if (!disabled) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const taskId = draggedTaskId(event);
          if (taskId && taskId !== task.id && !disabled) {
            onPlace(taskId, projectId, task.parent_id ?? null, task.id);
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
          if (!disabled) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const taskId = draggedTaskId(event);
          if (taskId && taskId !== task.id && !disabled) onPlace(taskId, projectId, task.id);
        }}
      >
        <button type="button" onClick={() => onSelectTask(task.id)}>
          <span>{children.length ? '▾' : '•'}</span>
          <strong>{task.title}</strong>
          <small>{task.status.replace('_', ' ')}</small>
        </button>
        {selectedTaskId && selectedTaskId !== task.id && (
          <div className="cc-inbox-tree__placement-actions">
            <button
              type="button"
              className="cc-inbox-tree__place-button"
              aria-label={`Place selected task before ${task.title}`}
              disabled={disabled}
              onClick={() => onPlace(selectedTaskId, projectId, task.parent_id ?? null, task.id)}
            >
              Before
            </button>
            <button
              type="button"
              className="cc-inbox-tree__place-button"
              aria-label={`Place selected task under ${task.title}`}
              disabled={disabled}
              onClick={() => onPlace(selectedTaskId, projectId, task.id)}
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
          disabled={disabled}
          onSelectTask={onSelectTask}
          onPlace={onPlace}
        />
      ))}
    </div>
  );
}
