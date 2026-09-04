import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useDeleteProject,
  useGetOrCreateProjectConversation,
  useExecutionProvidersQuery,
  useProjectQuery,
  useTestPaseoConnection,
  useTodosQuery,
  useUpdateProject,
} from '../hooks/queries';
import { ChatBubbleIcon, ChevronLeftIcon, EditIcon, TrashIcon } from '../components/shared/Icons';
import EmptyState from '../components/shared/EmptyState';
import ProjectArtifacts from '../components/projects/ProjectArtifacts';
import ProjectActivity from '../components/projects/ProjectActivity';
import ProjectPlan from '../components/projects/ProjectPlan';
import type { ProjectOverviewResponse } from '../types/api';
import ProjectWorkspaceHosts from '../components/shared/ProjectWorkspaceHosts';
import { useChatPanelController } from '../components/chat-panel/ChatPanelControllerContext';
import usePlatform from '../hooks/usePlatform';
import { useToastStore } from '../stores/useToastStore';
import { translateUi } from '../i18n';
import CanonicalDocumentButton from '../components/shared/CanonicalDocumentButton';
import { extractCanonicalDoc } from '../utils/canonicalDoc';

type ProjectSection = 'plan' | 'activity' | 'files';

export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{
    projectId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const section: ProjectSection =
    requestedSection === 'activity'
      ? 'activity'
      : requestedSection === 'files' || requestedSection === 'artifacts'
        ? 'files'
        : 'plan';
  const { data: project, isLoading, isError } = useProjectQuery(projectId);
  const { data: todos = [] } = useTodosQuery();
  const { mutateAsync: getOrCreateConversation, isPending: isOpeningConversation } =
    useGetOrCreateProjectConversation();
  const deleteProject = useDeleteProject();
  const {
    open: openChatPanel,
    reset: resetChatPanel,
    presentation: panelPresentation,
    setPresentation: setPanelPresentation,
  } = useChatPanelController();
  const { isMobile } = usePlatform();
  const addToast = useToastStore((state) => state.addToast);
  const autoOpenedProjectId = useRef<string | null>(null);
  const lifecycleGeneration = useRef(0);
  const projectTasks = useMemo(
    () =>
      todos
        .filter((todo) => todo.project_id === projectId && todo.id !== project?.root_task_id)
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0)),
    [project?.root_task_id, projectId, todos],
  );
  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    return () => {
      if (lifecycleGeneration.current === generation) lifecycleGeneration.current += 1;
      autoOpenedProjectId.current = null;
      resetChatPanel();
    };
  }, [projectId, resetChatPanel]);
  const openProjectAgent = useCallback(async () => {
    if (!project?.root_task_id) return;
    const generation = lifecycleGeneration.current;
    try {
      const conversation = await getOrCreateConversation(project.root_task_id);
      if (lifecycleGeneration.current !== generation) return;
      openChatPanel(conversation.id, {
        kind: 'project',
        title: 'Project Agent',
        subtitle: project.title,
      });
    } catch {
      if (lifecycleGeneration.current === generation) {
        addToast('error', translateUi('Could not open the agent conversation.'));
      }
    }
  }, [addToast, getOrCreateConversation, openChatPanel, project]);
  const openTaskAgent = useCallback(
    async (task: (typeof projectTasks)[number], breadcrumb: string) => {
      if (!project) return;
      const generation = lifecycleGeneration.current;
      try {
        const conversation = await getOrCreateConversation(task.id);
        if (lifecycleGeneration.current !== generation) return;
        openChatPanel(conversation.id, {
          kind: 'task',
          title: 'Task Agent',
          subtitle: `${project.title} › ${breadcrumb}`,
        });
      } catch {
        if (lifecycleGeneration.current === generation) {
          addToast('error', translateUi('Could not open the agent conversation.'));
        }
      }
    },
    [addToast, getOrCreateConversation, openChatPanel, project],
  );
  useEffect(() => {
    if (!project || isMobile || autoOpenedProjectId.current === project.id) return;
    autoOpenedProjectId.current = project.id;
    void openProjectAgent();
  }, [isMobile, openProjectAgent, project]);
  useEffect(() => {
    if (!project || panelPresentation.kind !== 'project') return;
    if (panelPresentation.subtitle === project.title) return;
    setPanelPresentation({ kind: 'project', title: 'Project Agent', subtitle: project.title });
  }, [panelPresentation.kind, panelPresentation.subtitle, project, setPanelPresentation]);
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
        <div className="cc-project-workspace__identity-column">
          <ProjectIdentity project={project} />
          <ProjectMachineLine project={project} />
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          onClick={() => void openProjectAgent()}
          disabled={!project.root_task_id || isOpeningConversation}
        >
          <ChatBubbleIcon size={15} />
          {translateUi(' Project Agent')}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--danger"
          disabled={deleteProject.isPending}
          onClick={() => {
            if (
              window.confirm(
                translateUi('Delete “{{title}}”? Its tasks go back to the Inbox.', {
                  title: project.title,
                }),
              )
            ) {
              deleteProject.mutate(project.id, { onSuccess: () => navigate('/projects') });
            }
          }}
        >
          <TrashIcon size={15} />
          {translateUi('Delete project')}
        </button>
      </header>

      <div
        className="cc-project-workspace__tabs"
        aria-label={translateUi('Project workspace sections')}
      >
        <button
          type="button"
          className={`cc-project-workspace__tab${section === 'plan' ? ' cc-project-workspace__tab--active' : ''}`}
          onClick={() => setSearchParams({})}
        >
          {translateUi('Plan')}
        </button>
        <button
          type="button"
          className={`cc-project-workspace__tab${section === 'activity' ? ' cc-project-workspace__tab--active' : ''}`}
          onClick={() => setSearchParams({ section: 'activity' })}
        >
          {translateUi('Activity')}
          {project.running_agent_count + project.pending_review_count > 0
            ? ` (${project.running_agent_count + project.pending_review_count})`
            : ''}
        </button>
        <button
          type="button"
          className={`cc-project-workspace__tab${section === 'files' ? ' cc-project-workspace__tab--active' : ''}`}
          onClick={() => setSearchParams({ section: 'files' })}
        >
          {translateUi('Files')}
        </button>
      </div>

      {section === 'files' ? (
        <ProjectArtifacts projectId={project.id} />
      ) : section === 'activity' ? (
        <ProjectActivity project={project} todos={projectTasks} />
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
              <span>{translateUi('Running agents')}</span>
              <strong>{project.running_agent_count}</strong>
            </div>
            <div className="cc-project-metric">
              <span>{translateUi('Waiting review')}</span>
              <strong>{project.pending_review_count}</strong>
            </div>
          </section>

          <ProjectPlan project={project} todos={projectTasks} onDiscussTask={openTaskAgent} />

          <details className="cc-project-settings-disclosure">
            <summary>{translateUi('Execution settings')}</summary>
            <ProjectWorkspaceHosts projectId={project.id} />
            <ProjectExecutionSettings project={project} />
          </details>
        </>
      )}
    </div>
  );
}
/**
 * The project's name and goal, editable in place.
 *
 * Renaming used to be impossible from the UI: the API accepted it, and the
 * root task followed, but nothing on this page asked for a new title.
 */
function ProjectIdentity({ project }: { project: ProjectOverviewResponse }) {
  const updateProject = useUpdateProject(project.id);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [goal, setGoal] = useState(project.goal ?? '');
  useEffect(() => {
    if (!editing) {
      setTitle(project.title);
      setGoal(project.goal ?? '');
    }
  }, [editing, project.goal, project.title]);
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    updateProject.mutate(
      { title: nextTitle, goal: goal.trim() || null },
      { onSuccess: () => setEditing(false) },
    );
  };
  if (editing) {
    return (
      <form className="cc-project-workspace__identity cc-project-identity-form" onSubmit={save}>
        <input
          type="text"
          className="cc-project-identity-form__title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label={translateUi('Project title')}
          placeholder={translateUi('Project title')}
          autoFocus
        />
        <input
          type="text"
          className="cc-project-identity-form__goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          aria-label={translateUi('Goal (optional)')}
          placeholder={translateUi('Goal (optional)')}
        />
        <div className="cc-project-identity-form__actions">
          <button
            type="submit"
            className="cc-btn cc-btn--primary"
            disabled={!title.trim() || updateProject.isPending}
          >
            {translateUi('Save')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            disabled={updateProject.isPending}
            onClick={() => setEditing(false)}
          >
            {translateUi('Cancel')}
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="cc-project-workspace__identity">
      <span
        className={`cc-project-workspace__status cc-project-workspace__status--${project.status}`}
      >
        {project.status}
      </span>
      <div className="cc-project-workspace__title-row">
        <h1>{project.title}</h1>
        <button
          type="button"
          className="cc-icon-button"
          aria-label={translateUi('Edit project')}
          title={translateUi('Edit project')}
          onClick={() => setEditing(true)}
        >
          <EditIcon size={14} />
        </button>
      </div>
      {(project.goal || project.description) && <p>{project.goal || project.description}</p>}
      <CanonicalDocumentButton target={extractCanonicalDoc(project.description)} />
    </div>
  );
}

/** Where this project's work runs, at a glance: machine, reachability, path. */
function ProjectMachineLine({ project }: { project: ProjectOverviewResponse }) {
  if (!project.execution_host_label) {
    return (
      <p className="cc-project-workspace__machine cc-project-workspace__machine--unset">
        {translateUi('No machine chosen — set one under "Where this runs".')}
      </p>
    );
  }
  const online = project.execution_host_online;
  return (
    <p
      className={`cc-project-workspace__machine cc-project-workspace__machine--${online ? 'online' : 'offline'}`}
    >
      <span className="cc-project-card__host-dot" aria-hidden="true" />
      {translateUi('Runs on {{host}}', { host: project.execution_host_label })}
      {' · '}
      {online
        ? translateUi('Online')
        : translateUi('Machine offline — runs are refused until it is back')}
      {project.execution_workspace_path ? ` · ${project.execution_workspace_path}` : ''}
    </p>
  );
}

function ProjectExecutionSettings({ project }: { project: ProjectOverviewResponse }) {
  const { data: providers = [], isLoading } = useExecutionProvidersQuery();
  const testPaseo = useTestPaseoConnection();
  const updateProject = useUpdateProject(project.id, 'Execution settings saved');
  const [provider, setProvider] = useState(project.default_execution_provider || 'builtin');
  const [model, setModel] = useState(project.default_execution_model || 'codex');
  const [isolation, setIsolation] = useState<'local' | 'worktree'>(
    project.execution_workspace_isolation || 'local',
  );
  const [baseBranch, setBaseBranch] = useState(project.execution_base_branch || '');
  const [executionInstructions, setExecutionInstructions] = useState(
    project.execution_instructions || '',
  );
  useEffect(() => {
    setProvider(project.default_execution_provider || 'builtin');
    setModel(project.default_execution_model || 'codex');
    setIsolation(project.execution_workspace_isolation || 'local');
    setBaseBranch(project.execution_base_branch || '');
    setExecutionInstructions(project.execution_instructions || '');
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
      execution_instructions: executionInstructions.trim() || null,
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
        <label className="cc-project-execution-form__rules">
          <span>{translateUi('Agent execution rules')}</span>
          <textarea
            value={executionInstructions}
            onChange={(event) => setExecutionInstructions(event.target.value)}
            placeholder={translateUi(
              'Rules added to the beginning of every agent run in this project',
            )}
            rows={7}
          />
        </label>
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
