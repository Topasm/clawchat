import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useChooseOrcaRepository,
  useDeleteProject,
  useGetOrCreateProjectConversation,
  useExecutionProvidersQuery,
  useOrcaRepositoriesQuery,
  useProjectQuery,
  useTaskExecutionTelemetryQuery,
  useTestExecutionProvider,
  useTodosQuery,
  useUpdateProject,
} from '../hooks/queries';
import { ChevronLeftIcon, EditIcon, SettingsIcon, TrashIcon } from '../components/shared/Icons';
import Dialog from '../components/shared/Dialog';
import EmptyState from '../components/shared/EmptyState';
import ProjectArtifacts from '../components/projects/ProjectArtifacts';
import ProjectActivity from '../components/projects/ProjectActivity';
import ProjectPlan from '../components/projects/ProjectPlan';
import InboxNotesPanel from '../components/inbox/InboxNotesPanel';
import { projectStatusLabel } from '../components/projects/projectStatus';
import type { ProjectOverviewResponse } from '../types/api';
import ProjectWorkspaceHosts from '../components/shared/ProjectWorkspaceHosts';
import { useChatPanelController } from '../components/chat-panel/ChatPanelControllerContext';
import { useChatContextStore } from '../hooks/useContextChat';
import usePlatform from '../hooks/usePlatform';
import { useToastStore } from '../stores/useToastStore';
import { translateUi } from '../i18n';
import CanonicalDocumentButton from '../components/shared/CanonicalDocumentButton';
import { extractCanonicalDoc } from '../utils/canonicalDoc';
import { getChatWorkspaceScope, useChatStore } from '../stores/useChatStore';
import apiClient from '../services/apiClient';
import { ConversationResponseSchema } from '../types/schemas';

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
  // Provider, model and rules are advanced settings in a dialog, offered only
  // once the project has work handed to an agent.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: project, isLoading, isError } = useProjectQuery(projectId);
  const { data: todos = [], isLoading: areTodosLoading } = useTodosQuery();
  const { mutateAsync: getOrCreateConversation } = useGetOrCreateProjectConversation();
  const deleteProject = useDeleteProject();
  const {
    open: openChatPanel,
    reset: resetChatPanel,
    presentation: panelPresentation,
    setPresentation: setPanelPresentation,
    setConversationId: setPanelConversationId,
    conversationId: panelConversationId,
    beginSelection,
  } = useChatPanelController();
  const { isMobile } = usePlatform();
  const addToast = useToastStore((state) => state.addToast);
  const autoOpenedProjectId = useRef<string | null>(null);
  const lifecycleGeneration = useRef(0);
  const currentPanelConversation = useRef(panelConversationId);
  currentPanelConversation.current = panelConversationId;
  const { data: telemetry = [] } = useTaskExecutionTelemetryQuery(projectId);
  const telemetryByTask = useMemo(
    () => new Map(telemetry.map((entry) => [entry.task_id, entry])),
    [telemetry],
  );
  const projectTasks = useMemo(
    () =>
      todos
        .filter((todo) => todo.project_id === projectId && todo.id !== project?.root_task_id)
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0)),
    [project?.root_task_id, projectId, todos],
  );
  useEffect(() => {
    lifecycleGeneration.current += 1;
    return () => {
      lifecycleGeneration.current += 1;
      autoOpenedProjectId.current = null;
      resetChatPanel();
    };
  }, [projectId, resetChatPanel]);
  const openProjectAgent = useCallback(async () => {
    if (!project?.root_task_id) return;
    const generation = ++lifecycleGeneration.current;
    const isCurrentSelection = beginSelection?.() ?? (() => true);
    try {
      const conversation = await getOrCreateConversation(project.root_task_id);
      if (lifecycleGeneration.current !== generation || !isCurrentSelection()) return;
      openChatPanel(conversation.id, {
        projectId: project.id,
        kind: 'project',
        title: 'Project Agent',
        subtitle: project.title,
      });
    } catch {
      if (lifecycleGeneration.current === generation) {
        addToast('error', translateUi('Could not open the agent conversation.'));
      }
    }
  }, [addToast, getOrCreateConversation, openChatPanel, project, beginSelection]);
  const openTaskAgent = useCallback(
    async (task: (typeof projectTasks)[number], breadcrumb: string) => {
      if (!project) return;
      const generation = ++lifecycleGeneration.current;
      const isCurrentSelection = beginSelection?.() ?? (() => true);
      try {
        const conversation = await getOrCreateConversation(task.id);
        if (lifecycleGeneration.current !== generation || !isCurrentSelection()) return;
        openChatPanel(conversation.id, {
          projectId: project.id,
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
    [addToast, getOrCreateConversation, openChatPanel, project, beginSelection],
  );
  // ⌘K and the top-right button open this project's agent while it is on screen.
  useEffect(() => {
    useChatContextStore.getState().setOpenHere(() => void openProjectAgent());
    return () => useChatContextStore.getState().setOpenHere(null);
  }, [openProjectAgent]);
  // Restore the thread the user last had open for this project. A project with
  // no remembered thread opens with the plan alone; the agent is a click away.
  useEffect(() => {
    if (!project || areTodosLoading || autoOpenedProjectId.current === project.id) return;
    autoOpenedProjectId.current = project.id;
    const generation = lifecycleGeneration.current;
    const initialPanelConversation = currentPanelConversation.current;
    const savedId =
      useChatStore.getState().activeConversationByProject[
        JSON.stringify([getChatWorkspaceScope(), project.id])
      ];
    if (!savedId) return;
    const isCurrentSelection = beginSelection?.() ?? (() => true);
    void (async () => {
      try {
        const response = await apiClient.get(`/chat/conversations/${savedId.conversationId}`);
        const conversation = ConversationResponseSchema.parse(response.data);
        if (lifecycleGeneration.current !== generation || !isCurrentSelection()) return;
        if (currentPanelConversation.current !== initialPanelConversation) return;
        const task = projectTasks.find((item) => item.id === conversation.project_todo_id);
        if (
          !conversation.is_archived &&
          (conversation.project_id === project.id ||
            conversation.project_todo_id === project.root_task_id ||
            task)
        ) {
          const isRun = savedId.kind === 'run';
          const presentation = {
            projectId: project.id,
            kind: isRun ? ('run' as const) : task ? ('task' as const) : ('project' as const),
            title: isRun || task ? 'Task Agent' : 'Project Agent',
            subtitle: task ? `${project.title} › ${task.title}` : project.title,
          };
          if (isMobile) {
            setPanelPresentation(presentation);
            setPanelConversationId(conversation.id);
          } else openChatPanel(conversation.id, presentation);
          return;
        }
        useChatStore.getState().rememberProjectConversation(project.id, null);
      } catch (error) {
        if (lifecycleGeneration.current !== generation || !isCurrentSelection()) return;
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 404) {
          useChatStore.getState().rememberProjectConversation(project.id, null);
        } else {
          addToast('error', translateUi('Could not open the agent conversation.'));
          return;
        }
      }
    })();
  }, [
    isMobile,
    areTodosLoading,
    openChatPanel,
    project,
    projectTasks,
    setPanelPresentation,
    setPanelConversationId,
    addToast,
    beginSelection,
  ]);
  useEffect(() => {
    if (!project || panelPresentation.kind !== 'project') return;
    if (panelPresentation.subtitle === project.title) return;
    setPanelPresentation({
      projectId: project.id,
      kind: 'project',
      title: 'Project Agent',
      subtitle: project.title,
    });
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
  // A project of the user's own work needs no execution settings; they come
  // forward once something here is handed to an agent (or was set up before).
  const hasDelegatedWork =
    project.running_agent_count > 0 ||
    project.pending_review_count > 0 ||
    !!project.execution_host_id ||
    !!project.default_execution_provider ||
    projectTasks.some(
      (task) => !!task.assignee || !!telemetryByTask.get(task.id)?.latest_run_status,
    );
  // One grey line instead of a strip of four numbers; a zero says nothing.
  const overview = [
    project.ready_count > 0 ? translateUi('{{count}} ready', { count: project.ready_count }) : null,
    project.blocked_count > 0
      ? translateUi('{{count}} blocked', { count: project.blocked_count })
      : null,
    project.running_agent_count > 0
      ? translateUi('{{count}} running', { count: project.running_agent_count })
      : null,
    project.pending_review_count > 0
      ? translateUi('{{count}} to review', { count: project.pending_review_count })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
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
        </div>
        {hasDelegatedWork && (
          <button
            type="button"
            className="cc-icon-button"
            aria-label={translateUi('Execution settings')}
            title={translateUi('Execution settings')}
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon size={16} />
          </button>
        )}
        {/* Destructive and rare: an icon beside the primary action, not a
            second button competing with it. It still asks first. */}
        <button
          type="button"
          className="cc-icon-button cc-project-workspace__delete"
          aria-label={translateUi('Delete project')}
          title={translateUi('Delete project')}
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
          <TrashIcon size={16} />
        </button>
      </header>

      <Dialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={translateUi('Execution settings')}
        className="cc-dialog__content--wide cc-project-settings-dialog"
      >
        <ProjectExecutionSettings project={project} />
      </Dialog>

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
          {/* The first screen: the project's folder on each device, its work,
              then its notes. */}
          <ProjectWorkspaceHosts key={project.id} projectId={project.id} />
          {overview && <p className="cc-project-workspace__summary">{overview}</p>}

          <ProjectActivity project={project} todos={projectTasks} attentionOnly />
          <ProjectPlan project={project} todos={projectTasks} onDiscussTask={openTaskAgent} />
          <section className="cc-project-workspace__section" aria-label={translateUi('Notes')}>
            <div className="cc-project-workspace__section-header">
              <h2>{translateUi('Notes')}</h2>
            </div>
            <InboxNotesPanel projects={[project]} projectId={project.id} compact />
          </section>
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
  const statusLabel = projectStatusLabel(project.status);
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
      {statusLabel && (
        <span
          className={`cc-project-workspace__status cc-project-workspace__status--${project.status}`}
        >
          {statusLabel}
        </span>
      )}
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

/** The project's provider as the form offers it; a removed one (Paseo) reads as built-in. */
function offeredProvider(provider: string | null | undefined): string {
  return provider && provider !== 'paseo' ? provider : 'builtin';
}

function ProjectExecutionSettings({ project }: { project: ProjectOverviewResponse }) {
  const { data: providers = [], isLoading } = useExecutionProvidersQuery();
  const testProvider = useTestExecutionProvider();
  const updateProject = useUpdateProject(project.id, 'Execution settings saved');
  const [provider, setProvider] = useState(offeredProvider(project.default_execution_provider));
  const [model, setModel] = useState(project.default_execution_model || '');
  const [isolation, setIsolation] = useState<'local' | 'worktree'>(
    project.execution_workspace_isolation || 'local',
  );
  const [baseBranch, setBaseBranch] = useState(project.execution_base_branch || '');
  const [executionInstructions, setExecutionInstructions] = useState(
    project.execution_instructions || '',
  );
  useEffect(() => {
    setProvider(offeredProvider(project.default_execution_provider));
    setModel(project.default_execution_model || '');
    setIsolation(project.execution_workspace_isolation || 'local');
    setBaseBranch(project.execution_base_branch || '');
    setExecutionInstructions(project.execution_instructions || '');
  }, [project]);
  const opencode = providers.find((item) => item.id === 'opencode');
  const orca = providers.find((item) => item.id === 'orca');
  // Only a provider ClawChat bridges to has a connection worth showing.
  const external = provider === 'opencode' ? opencode : provider === 'orca' ? orca : undefined;
  const externalLabel = provider === 'opencode' ? translateUi('OpenCode') : translateUi('Orca');
  const isBridged = provider === 'opencode' || provider === 'orca';
  const { data: orcaRepos = [] } = useOrcaRepositoriesQuery(provider === 'orca' && !!orca?.enabled);
  const chooseRepo = useChooseOrcaRepository(project.id);
  const repoPath = project.execution_workspace_path ?? '';
  const repoListed = orcaRepos.some((repo) => repo.path === repoPath);
  // ClawChat's own Orca starts with no repositories: a folder joins it on its first run.
  const [folder, setFolder] = useState('');
  const chooseFolder = () => {
    if (folder.trim()) chooseRepo.mutate(folder.trim());
  };
  const externalStarting =
    !!external?.managed &&
    (external.runtime_state === 'starting' || external.runtime_state === 'restarting');
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    updateProject.mutate({
      default_execution_provider: provider,
      default_execution_model: isBridged ? model.trim() || null : null,
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
        {isBridged && (
          <div className="cc-project-execution-settings__health">
            <span
              className={`cc-settings-status cc-settings-status--${external?.connected ? 'success' : 'muted'}`}
            >
              {externalLabel}{' '}
              {isLoading
                ? translateUi('checking\u2026')
                : external?.connected
                  ? external.managed
                    ? translateUi('connected · started by ClawChat')
                    : translateUi('connected · {{host}}', { host: external.host ?? '' })
                  : externalStarting
                    ? translateUi('starting…')
                    : translateUi('offline')}
            </span>
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              disabled={testProvider.isPending}
              onClick={() => testProvider.mutate(provider)}
            >
              {translateUi('Test connection')}
            </button>
          </div>
        )}
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
            <option value="opencode" disabled={!opencode?.enabled}>
              {translateUi('OpenCode')}
              {opencode?.enabled ? '' : translateUi(' (disabled on server)')}
            </option>
            <option value="orca" disabled={!orca?.enabled}>
              {translateUi('Orca')}
              {orca?.enabled ? '' : translateUi(' (disabled on server)')}
            </option>
          </select>
        </label>
        {provider === 'orca' && (
          <>
            <label>
              <span>{translateUi('Repository')}</span>
              <select
                value={repoPath}
                disabled={chooseRepo.isPending || !orca?.connected}
                onChange={(event) => chooseRepo.mutate(event.target.value)}
              >
                <option value="" disabled>
                  {orcaRepos.length > 0
                    ? translateUi('Choose a repository')
                    : translateUi('No repositories in Orca yet')}
                </option>
                {repoPath && !repoListed && <option value={repoPath}>{repoPath}</option>}
                {orcaRepos.map((repo) => (
                  <option key={repo.path} value={repo.path}>
                    {repo.name}
                  </option>
                ))}
              </select>
              {repoPath && (
                <small className="cc-project-execution-form__hint" title={repoPath}>
                  {repoPath}
                </small>
              )}
              {orca?.connected && orcaRepos.length === 0 && !orca.managed && (
                <small className="cc-project-execution-form__hint">
                  {translateUi('Add one in Orca first (orca-ide repo add --path <folder>).')}
                </small>
              )}
            </label>
            {orca?.managed && (
              <label>
                <span>{translateUi('Or a folder on this machine')}</span>
                <span className="cc-project-execution-form__folder">
                  <input
                    value={folder}
                    onChange={(event) => setFolder(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        chooseFolder();
                      }
                    }}
                    placeholder={translateUi('Folder path')}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="cc-btn cc-btn--ghost"
                    disabled={!folder.trim() || chooseRepo.isPending}
                    onClick={chooseFolder}
                  >
                    {translateUi('Use folder')}
                  </button>
                </span>
              </label>
            )}
            <label>
              <span>{translateUi('Each task works in')}</span>
              <select
                value={isolation}
                onChange={(event) => setIsolation(event.target.value as 'local' | 'worktree')}
              >
                <option value="worktree">{translateUi('Its own worktree (recommended)')}</option>
                <option value="local">{translateUi('The repository folder itself')}</option>
              </select>
            </label>
            {orca?.permission_mode && (
              <p className="cc-project-execution-form__note">
                <strong>{translateUi('Agent permissions')}</strong>{' '}
                {orca.permission_mode === 'ask'
                  ? translateUi(
                      'Ask: read-only, and anything more waits for your approval here. Code cannot be edited in this mode.',
                    )
                  : translateUi(
                      "Auto: edits inside the task's worktree; the agent's own reviewer decides anything beyond it.",
                    )}{' '}
                {translateUi('Set on the server with ORCA_PERMISSION_MODE.')}
              </p>
            )}
            <details className="cc-project-execution-form__advanced">
              <summary>{translateUi('Advanced')}</summary>
              <div className="cc-project-execution-form__advanced-fields">
                <label>
                  <span>{translateUi('Orca model')}</span>
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder={translateUi("empty uses the agent's cheaper tier")}
                  />
                </label>
                {isolation === 'worktree' && (
                  <label>
                    <span>{translateUi('Base branch')}</span>
                    <input
                      value={baseBranch}
                      onChange={(event) => setBaseBranch(event.target.value)}
                      placeholder={translateUi("empty uses the repository's default")}
                    />
                  </label>
                )}
              </div>
            </details>
          </>
        )}
        {provider === 'opencode' && (
          <label>
            <span>{translateUi('OpenCode model')}</span>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={translateUi('provider/model — empty uses the server default')}
            />
          </label>
        )}
        <div className="cc-project-execution-form__actions">
          {external?.error && <small>{external.error}</small>}
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
