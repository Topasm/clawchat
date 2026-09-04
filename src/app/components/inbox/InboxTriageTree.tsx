import type {
  ProjectResponse,
  TaskExecutionTelemetryResponse,
  TodoResponse,
} from '../../types/api';
import { getTaskExecutionBadges } from '../../utils/taskExecutionTelemetry';
import { isInboxTodo } from '../../utils/inboxState';
import { isTerminalTaskStatus } from '../../utils/taskStatus';
import { InsertionTarget, Pane } from '../shared/WorkspacePrimitives';
import {
  acceptsPlacementDrag,
  draggedDependencyTaskId,
  draggedPlacementTaskIds,
  INBOX_DEPENDENCY_DRAG_TYPE,
  INBOX_TASK_DRAG_TYPE,
  transferHasType,
} from './inboxDragTransfer';
import { translateUi } from '../../i18n';
interface InboxTriageTreeProps {
  projects: ProjectResponse[];
  todos: TodoResponse[];
  selectedTaskId: string | null;
  batchTaskIds: string[];
  telemetryByTaskId?: ReadonlyMap<string, TaskExecutionTelemetryResponse>;
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
  /** Opens the project's own page; the tree header is the natural way there. */
  onOpenProject?: (projectId: string) => void;
}
function sorted(items: TodoResponse[]) {
  return [...items].sort(
    (left, right) =>
      (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.title.localeCompare(right.title),
  );
}
export default function InboxTriageTree({
  projects,
  todos,
  selectedTaskId,
  batchTaskIds,
  telemetryByTaskId = new Map(),
  disabled,
  onSelectTask,
  onPlace,
  onPlaceBatch,
  onPreviewDependency,
  onOpenProject,
}: InboxTriageTreeProps) {
  const projectRoots = new Set(projects.flatMap((project) => project.root_task_id ?? []));
  // Open tasks that live in no project and are not in the Inbox queue either.
  // Without this group they were invisible on this page: not captured, so not
  // in the queue; not placed, so not in any project branch.
  const unfiled = sorted(
    todos.filter(
      (todo) =>
        !todo.project_id &&
        !todo.parent_id &&
        !projectRoots.has(todo.id) &&
        !isInboxTodo(todo) &&
        !isTerminalTaskStatus(todo.status),
    ),
  );
  return (
    <Pane as="section" className="cc-inbox-tree" aria-label={translateUi('Project work tree')}>
      <header className="cc-inbox-tree__header">
        <div>
          <strong>{translateUi('Project / Work Tree')}</strong>
          <span>
            {batchTaskIds.length > 1
              ? translateUi('{{count}} tasks selected for one atomic move', {
                  count: batchTaskIds.length,
                })
              : translateUi('Drop a card to place the same task')}
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
                {onOpenProject ? (
                  <button
                    type="button"
                    className="cc-inbox-tree__project-link"
                    aria-label={translateUi('Open project {{title}}', { title: project.title })}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <strong>{project.title}</strong>
                  </button>
                ) : (
                  <strong>{project.title}</strong>
                )}
                <span>
                  {project.task_count}
                  {translateUi(' tasks')}
                </span>
                {(selectedTaskId || batchTaskIds.length > 1) && (
                  <button
                    type="button"
                    aria-label={
                      batchTaskIds.length > 1
                        ? translateUi('Place {{count}} selected tasks in {{title}}', {
                            count: batchTaskIds.length,
                            title: project.title,
                          })
                        : translateUi('Place selected task in {{title}}', {
                            title: project.title,
                          })
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
                    {translateUi('\n                    Place here\n                  ')}
                  </button>
                )}
              </div>
              <div className="cc-inbox-tree__nodes">
                {roots.length === 0 ? (
                  <span className="cc-inbox-tree__empty">
                    {translateUi('Drop here to start this project')}
                  </span>
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
                      telemetryByTaskId={telemetryByTaskId}
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
          <div className="cc-inbox-tree__empty">
            {translateUi('Create a project before placing Inbox tasks.')}
          </div>
        )}
        {unfiled.length > 0 && (
          <div
            className="cc-inbox-tree__project cc-inbox-tree__project--unfiled"
            aria-label={translateUi('No project')}
          >
            <div className="cc-inbox-tree__project-target">
              <strong>{translateUi('No project')}</strong>
              <span>
                {unfiled.length}
                {translateUi(' tasks')}
              </span>
            </div>
            <p className="cc-inbox-tree__hint">
              {translateUi(
                'Tasks that belong to no project. Drag one onto a project, or place it from the Inbox.',
              )}
            </p>
            <div className="cc-inbox-tree__nodes">
              {unfiled.map((task) => (
                <div
                  key={task.id}
                  className={`cc-inbox-tree__node${selectedTaskId === task.id ? ' cc-inbox-tree__node--selected' : ''}`}
                  draggable={!disabled}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(INBOX_TASK_DRAG_TYPE, task.id);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <button type="button" onClick={() => onSelectTask(task.id)}>
                    <span>•</span>
                    <span className="cc-inbox-tree__identity">
                      <strong>{task.title}</strong>
                    </span>
                    <small>{task.status.replace('_', ' ')}</small>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
}
function TreeNode({
  task,
  projectId,
  childrenByParent,
  depth,
  selectedTaskId,
  batchTaskIds,
  telemetryByTaskId,
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
  telemetryByTaskId: ReadonlyMap<string, TaskExecutionTelemetryResponse>;
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
  const executionBadges = getTaskExecutionBadges(telemetryByTaskId.get(task.id));
  return (
    <div className="cc-inbox-tree__branch">
      <InsertionTarget
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
          <span className="cc-inbox-tree__identity">
            <strong>{task.title}</strong>
            {executionBadges.length > 0 && (
              <span
                className="cc-inbox-tree__telemetry"
                aria-label={translateUi('Execution activity')}
              >
                {executionBadges.map((badge) => (
                  <span
                    key={badge.key}
                    className="cc-inbox-tree__telemetry-badge"
                    data-tone={badge.tone}
                  >
                    {badge.label}
                  </span>
                ))}
              </span>
            )}
          </span>
          <small>{task.status.replace('_', ' ')}</small>
        </button>
        <button
          type="button"
          className="cc-inbox-tree__dependency-handle"
          aria-label={translateUi(
            'Dependency connector for {{title}}. Drag to a prerequisite or drop a dependent here.',
            { title: task.title },
          )}
          title={
            selectedTaskId && selectedTaskId !== task.id
              ? translateUi('Make selected task wait for {{title}}', { title: task.title })
              : translateUi('Drag to the task that must finish first')
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
            if (!disabled && transferHasType(event, INBOX_DEPENDENCY_DRAG_TYPE)) {
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
                  ? translateUi('Place {{count}} selected tasks before {{title}}', {
                      count: batchTaskIds.length,
                      title: task.title,
                    })
                  : translateUi('Place selected task before {{title}}', { title: task.title })
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
              {translateUi('\n              Before\n            ')}
            </button>
            <button
              type="button"
              className="cc-inbox-tree__place-button"
              aria-label={
                batchTaskIds.length > 1
                  ? translateUi('Place {{count}} selected tasks under {{title}}', {
                      count: batchTaskIds.length,
                      title: task.title,
                    })
                  : translateUi('Place selected task under {{title}}', { title: task.title })
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
              {translateUi('\n              Under\n            ')}
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
          telemetryByTaskId={telemetryByTaskId}
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
