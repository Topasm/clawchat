import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { KanbanStatus, TodoResponse } from '../../types/api';
import usePlatform from '../../hooks/usePlatform';
import { useAuthStore } from '../../stores/useAuthStore';
import SegmentedControl from '../shared/SegmentedControl';
import { SparkleIcon } from '../shared/Icons';
import { buildTaskGraphElements, expandTaskGraphContext } from './taskGraphAdapter';
import TaskGraphView from './TaskGraphView';
import TaskGraphProposalDialog from './TaskGraphProposalDialog';
import type { TaskGraphMode } from './taskGraphTypes';

interface TaskGraphProps {
  todos: TodoResponse[];
  metadataTodos?: TodoResponse[];
  kanbanStatuses: Record<string, KanbanStatus>;
}

const GRAPH_MODE_OPTIONS = [
  { label: 'Structure', value: 'structure' },
  { label: 'Execution', value: 'execution' },
];

export default function TaskGraph({ todos, metadataTodos = todos, kanbanStatuses }: TaskGraphProps) {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const [mode, setMode] = useState<TaskGraphMode>('structure');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [hideCompleted, setHideCompleted] = useState(true);
  const [projectId, setProjectId] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | KanbanStatus>('all');
  const [proposalOpen, setProposalOpen] = useState(false);

  const effectiveStatus = useCallback(
    (todo: TodoResponse): KanbanStatus => kanbanStatuses[todo.id] ?? (todo.status as KanbanStatus),
    [kanbanStatuses],
  );

  const childIdsByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    todos.forEach((todo) => {
      if (!todo.parent_id) return;
      map.set(todo.parent_id, [...(map.get(todo.parent_id) ?? []), todo.id]);
    });
    return map;
  }, [todos]);

  const projectOptions = useMemo(
    () => todos.filter((todo) => !todo.parent_id && (childIdsByParent.has(todo.id) || todo.source === 'obsidian_project')),
    [childIdsByParent, todos],
  );

  const planningTargets = useMemo(
    () => metadataTodos
      .filter((todo) => !todo.parent_id && effectiveStatus(todo) !== 'completed')
      .sort((a, b) => a.title.localeCompare(b.title)),
    [effectiveStatus, metadataTodos],
  );

  useEffect(() => {
    if (projectId !== 'all' && !projectOptions.some((project) => project.id === projectId)) {
      setProjectId('all');
    }
  }, [projectId, projectOptions]);

  const projectIds = useMemo(() => {
    if (projectId === 'all') return null;
    const ids = new Set<string>();
    const visit = (id: string) => {
      if (ids.has(id)) return;
      ids.add(id);
      childIdsByParent.get(id)?.forEach(visit);
    };
    visit(projectId);
    return ids;
  }, [childIdsByParent, projectId]);

  const graphTodos = useMemo(() => {
    const projectTodos = projectIds
      ? todos.filter((todo) => projectIds.has(todo.id))
      : todos;
    if (statusFilter === 'all') return projectTodos;

    const matches = projectTodos.filter((todo) => effectiveStatus(todo) === statusFilter);
    return expandTaskGraphContext(projectTodos, matches);
  }, [effectiveStatus, projectIds, statusFilter, todos]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const elements = useMemo(
    () => buildTaskGraphElements(graphTodos, {
      mode,
      collapsedIds,
      hideCompleted,
      kanbanStatuses,
      metadataTodos,
      onToggleCollapse: toggleCollapsed,
    }),
    [collapsedIds, graphTodos, hideCompleted, kanbanStatuses, metadataTodos, mode, toggleCollapsed],
  );

  const handleStatusFilter = (value: string) => {
    const next = value as typeof statusFilter;
    setStatusFilter(next);
    if (next === 'completed') setHideCompleted(false);
  };

  return (
    <section className="cc-task-flow" aria-label="Task graph">
      <div className="cc-task-flow__toolbar">
        <SegmentedControl
          ariaLabel="Graph mode"
          options={GRAPH_MODE_OPTIONS}
          value={mode}
          onChange={(value) => setMode(value as TaskGraphMode)}
        />

        <div className="cc-task-flow__filters">
          <button
            type="button"
            className="cc-btn cc-btn--primary cc-task-flow__ai-plan"
            onClick={() => setProposalOpen(true)}
            disabled={!serverUrl || planningTargets.length === 0}
            title={!serverUrl ? 'Connect to a server to use AI planning' : 'Generate a task graph proposal'}
          >
            <SparkleIcon size={14} /> AI plan
          </button>
          {projectOptions.length > 0 && (
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Filter graph by project">
              <option value="all">All projects</option>
              {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          )}
          <select value={statusFilter} onChange={(event) => handleStatusFilter(event.target.value)} aria-label="Filter graph by status">
            <option value="all">All statuses</option>
            <option value="pending">Todo</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Done</option>
          </select>
          <label className="cc-task-flow__completed-toggle">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(event) => setHideCompleted(event.target.checked)}
              disabled={statusFilter === 'completed'}
            />
            Hide completed
          </label>
          {collapsedIds.size > 0 && (
            <button type="button" className="cc-btn cc-btn--ghost" onClick={() => setCollapsedIds(new Set())}>
              Expand all
            </button>
          )}
        </div>
      </div>

      <div className="cc-task-flow__summary">
        <span>{mode === 'structure' ? 'Parent / child structure' : 'Dependency execution order'}</span>
        <span>{elements.nodes.length} nodes · {elements.edges.length} connections</span>
        <span className={`cc-task-flow__legend-line cc-task-flow__legend-line--${mode}`} />
        <span>{mode === 'structure' ? 'Sub-task' : 'Depends on'}</span>
      </div>

      <TaskGraphView
        nodes={elements.nodes}
        edges={elements.edges}
        isMobile={isMobile}
        onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
      />
      {proposalOpen && (
        <TaskGraphProposalDialog
          targets={planningTargets}
          initialTargetId={projectId === 'all' ? undefined : projectId}
          onOpenChange={setProposalOpen}
        />
      )}
    </section>
  );
}
