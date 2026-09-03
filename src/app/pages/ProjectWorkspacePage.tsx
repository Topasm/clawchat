import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useGetOrCreateProjectConversation,
  useExecutionProvidersQuery,
  useProjectQuery,
  useTestPaseoConnection,
  useTodosQuery,
  useUpdateProject,
} from '../hooks/queries';
import { ChatBubbleIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/shared/Icons';
import EmptyState from '../components/shared/EmptyState';
import ProjectArtifacts from '../components/projects/ProjectArtifacts';
import type { ProjectOverviewResponse } from '../types/api';
import ProjectWorkspaceHosts from '../components/shared/ProjectWorkspaceHosts';
import { translateUi } from '../i18n';
function formatMinutes(minutes: number | null | undefined) {
  if (minutes == null) return translateUi('Unknown');
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{
    projectId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get('section') === 'artifacts' ? 'artifacts' : 'overview';
  const { data: project, isLoading, isError } = useProjectQuery(projectId);
  const { data: todos = [] } = useTodosQuery();
  const getConversation = useGetOrCreateProjectConversation();
  const projectTasks = useMemo(
    () =>
      todos
        .filter((todo) => todo.project_id === projectId && todo.id !== project?.root_task_id)
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0)),
    [project?.root_task_id, projectId, todos],
  );
  const openConversation = async () => {
    if (!project?.root_task_id) return;
    const conversation = await getConversation.mutateAsync(project.root_task_id);
    navigate(`/chats/${conversation.id}`);
  };
  if (isLoading)
    return (
      <div className="cc-project-workspace__loading">{translateUi('Loading project\u2026')}</div>
    );
  if (isError || !project) {
    return (
      <EmptyState
        icon={<span>!</span>}
        message={translateUi('This project could not be loaded.')}
      />
    );
  }
  return (
    <div className="cc-project-workspace">
      <header className="cc-project-workspace__header">
        <button
          type="button"
          className="cc-icon-button"
          aria-label={translateUi('Back to projects')}
          onClick={() => navigate('/projects')}
        >
          <ChevronLeftIcon size={18} />
        </button>
        <div className="cc-project-workspace__identity">
          <span
            className={`cc-project-workspace__status cc-project-workspace__status--${project.status}`}
          >
            {project.status}
          </span>
          <h1>{project.title}</h1>
          {(project.goal || project.description) && <p>{project.goal || project.description}</p>}
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          onClick={openConversation}
          disabled={!project.root_task_id || getConversation.isPending}
        >
          <ChatBubbleIcon size={15} />
          {translateUi(' Context chat\n        ')}
        </button>
      </header>

      <div
        className="cc-project-workspace__tabs"
        aria-label={translateUi('Project workspace sections')}
      >
        <button
          type="button"
          className={`cc-project-workspace__tab${section === 'overview' ? ' cc-project-workspace__tab--active' : ''}`}
          onClick={() => setSearchParams({})}
        >
          {translateUi('\n          Overview\n        ')}
        </button>
        <button
          type="button"
          className="cc-project-workspace__tab"
          onClick={() => setSearchParams({})}
        >
          {translateUi('\n          Plan\n        ')}
        </button>
        <button
          type="button"
          className="cc-project-workspace__tab"
          onClick={() => navigate(`/runs?project_id=${project.id}`)}
        >
          {translateUi('\n          Runs')}
          {project.running_agent_count > 0 ? ` (${project.running_agent_count})` : ''}
        </button>
        <button
          type="button"
          className="cc-project-workspace__tab"
          onClick={() => navigate(`/review?project_id=${project.id}`)}
        >
          {translateUi('\n          Review')}
          {project.pending_review_count > 0 ? ` (${project.pending_review_count})` : ''}
        </button>
        <button
          type="button"
          className={`cc-project-workspace__tab${section === 'artifacts' ? ' cc-project-workspace__tab--active' : ''}`}
          onClick={() => setSearchParams({ section: 'artifacts' })}
        >
          {translateUi('\n          Artifacts\n        ')}
        </button>
        <span className="cc-project-workspace__tab">{translateUi('Schedule')}</span>
      </div>

      {section === 'artifacts' ? (
        <ProjectArtifacts projectId={project.id} />
      ) : (
        <>
          <section className="cc-project-metrics" aria-label={translateUi('Project overview')}>
            <div className="cc-project-metric">
              <span>{translateUi('Ready now')}</span>
              <strong>{project.ready_count}</strong>
            </div>
            <div className="cc-project-metric">
              <span>{translateUi('Blocked')}</span>
              <strong>{project.blocked_count}</strong>
            </div>
            <div className="cc-project-metric">
              <span>{translateUi('At risk')}</span>
              <strong>{project.at_risk_count}</strong>
            </div>
            <div className="cc-project-metric">
              <span>{translateUi('Running agents')}</span>
              <strong>{project.running_agent_count}</strong>
            </div>
            <div className="cc-project-metric">
              <span>{translateUi('Critical path')}</span>
              <strong>{formatMinutes(project.critical_path_minutes)}</strong>
            </div>
            <div className="cc-project-metric">
              <span>{translateUi('Waiting review')}</span>
              <strong>{project.pending_review_count}</strong>
            </div>
          </section>

          <ProjectWorkspaceHosts projectId={project.id} />

          <ProjectExecutionSettings project={project} />

          <section className="cc-project-workspace__section">
            <div className="cc-project-workspace__section-header">
              <div>
                <h2>{translateUi('Plan')}</h2>
                <p>
                  {project.completed_task_count}
                  {translateUi(' of ')}
                  {project.task_count}
                  {translateUi(' tasks completed\n                ')}
                </p>
              </div>
              {project.root_task_id && (
                <button
                  type="button"
                  className="cc-btn"
                  onClick={() => navigate(`/tasks/${project.root_task_id}`)}
                >
                  {translateUi('\n                  Open project root\n                ')}
                </button>
              )}
            </div>
            {projectTasks.length === 0 ? (
              <EmptyState
                icon={<span>✓</span>}
                message={translateUi(
                  'No execution tasks yet. Use context chat or open the project root to build a plan.',
                )}
              />
            ) : (
              <div className="cc-project-task-list">
                {projectTasks.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className="cc-project-task-row"
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  >
                    <span
                      className={`cc-project-task-row__state cc-project-task-row__state--${task.status}`}
                    />
                    <span className="cc-project-task-row__body">
                      <strong>{task.title}</strong>
                      <small>{task.status.replace('_', ' ')}</small>
                    </span>
                    {task.due_date && (
                      <time dateTime={task.due_date}>
                        {new Date(task.due_date).toLocaleDateString()}
                      </time>
                    )}
                    <ChevronRightIcon size={15} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function ProjectExecutionSettings({ project }: { project: ProjectOverviewResponse }) {
  const { data: providers = [], isLoading } = useExecutionProvidersQuery();
  const testPaseo = useTestPaseoConnection();
  const updateProject = useUpdateProject(project.id);
  const [provider, setProvider] = useState(project.default_execution_provider || 'builtin');
  const [model, setModel] = useState(project.default_execution_model || 'codex');
  const [isolation, setIsolation] = useState<'local' | 'worktree'>(
    project.execution_workspace_isolation || 'local',
  );
  const [baseBranch, setBaseBranch] = useState(project.execution_base_branch || '');
  useEffect(() => {
    setProvider(project.default_execution_provider || 'builtin');
    setModel(project.default_execution_model || 'codex');
    setIsolation(project.execution_workspace_isolation || 'local');
    setBaseBranch(project.execution_base_branch || '');
  }, [project]);
  const paseo = providers.find((item) => item.id === 'paseo');
  const paseoModels = (paseo?.providers ?? [])
    .map((item) => (typeof item.provider === 'string' ? item.provider : null))
    .filter((item): item is string => !!item);
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    updateProject.mutate({
      default_execution_provider: provider,
      default_execution_model: provider === 'paseo' ? model.trim() || 'codex' : null,
      execution_workspace_isolation: isolation,
      execution_base_branch: isolation === 'worktree' ? baseBranch.trim() || null : null,
    });
  };
  return (
    <section className="cc-project-workspace__section cc-project-execution-settings">
      <div className="cc-project-workspace__section-header">
        <div>
          <h2>{translateUi('Execution provider')}</h2>
          <p>
            {translateUi(
              'Choose where delegated tasks run. Plan generation continues to use ClawChat.',
            )}
          </p>
        </div>
        <div className="cc-project-execution-settings__health">
          <span
            className={`cc-settings-status cc-settings-status--${paseo?.connected ? 'success' : 'muted'}`}
          >
            {translateUi('\n            Paseo')}{' '}
            {isLoading
              ? translateUi('checking\u2026')
              : paseo?.connected
                ? translateUi('connected · {{host}}', { host: paseo.host ?? '' })
                : translateUi('offline')}
          </span>
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            disabled={testPaseo.isPending}
            onClick={() => testPaseo.mutate()}
          >
            {translateUi('\n            Test connection\n          ')}
          </button>
        </div>
      </div>
      <form className="cc-project-execution-form" onSubmit={save}>
        <label>
          <span>{translateUi('Provider')}</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="builtin">{translateUi('Built-in AI and skills')}</option>
            <option value="paseo" disabled={!paseo?.enabled}>
              {translateUi('\n              Paseo daemon')}
              {paseo?.enabled ? '' : translateUi(' (disabled on server)')}
            </option>
          </select>
        </label>
        {provider === 'paseo' && (
          <>
            <label>
              <span>{translateUi('Paseo provider / model')}</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={translateUi('codex/gpt-5.5')}
                list="cc-paseo-provider-list"
              />
              <datalist id="cc-paseo-provider-list">
                {paseoModels.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label>
              <span>{translateUi('Isolation')}</span>
              <select
                value={isolation}
                onChange={(event) => setIsolation(event.target.value as 'local' | 'worktree')}
              >
                <option value="worktree">{translateUi('New worktree')}</option>
                <option value="local">{translateUi('Local workspace')}</option>
              </select>
            </label>
            {isolation === 'worktree' && (
              <label>
                <span>{translateUi('Base branch')}</span>
                <input
                  value={baseBranch}
                  onChange={(event) => setBaseBranch(event.target.value)}
                  placeholder={translateUi('origin/main')}
                />
              </label>
            )}
          </>
        )}
        <div className="cc-project-execution-form__actions">
          {paseo?.error && provider === 'paseo' && <small>{paseo.error}</small>}
          <button
            type="submit"
            className="cc-btn cc-btn--primary"
            disabled={updateProject.isPending}
          >
            {updateProject.isPending
              ? translateUi('Saving\u2026')
              : translateUi('Save execution settings')}
          </button>
        </div>
      </form>
    </section>
  );
}
