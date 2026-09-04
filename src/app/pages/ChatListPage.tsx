import { useState, useMemo } from 'react';
import usePlatform from '../hooks/usePlatform';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  useConversationsQuery,
  useCreateProject,
  useDeleteProject,
  useProjectsQuery,
  useTodosQuery,
  useCreateConversation,
  useDeleteConversation,
} from '../hooks/queries';
import ConversationItem from '../components/shared/ConversationItem';
import EmptyState from '../components/shared/EmptyState';
import Badge from '../components/shared/Badge';
import { ChatBubbleIcon, CheckIcon, ChevronRightIcon, TrashIcon } from '../components/shared/Icons';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Dialog from '../components/shared/Dialog';
import { ChatListSkeleton } from '../components/shared/PageSkeletons';
import { getProjectIcon } from '../utils/projectIcons';
import { isTerminalTaskStatus } from '../utils/taskStatus';
import { ListRow } from '../components/shared/WorkspacePrimitives';
import { translateUi } from '../i18n';
export default function ChatListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const projectsOnly = location.pathname.replace(/\/+$/, '') === '/projects';
  const { data: conversations = [], isLoading: convsLoading } = useConversationsQuery();
  const { data: projects = [], isLoading: projsLoading } = useProjectsQuery();
  const { data: todos = [] } = useTodosQuery();
  const createConversationMutation = useCreateConversation();
  const createProjectMutation = useCreateProject();
  const deleteProjectMutation = useDeleteProject();
  const deleteConversationMutation = useDeleteConversation();
  const { isMobile } = usePlatform();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [quickChatsOpen, setQuickChatsOpen] = useState(true);
  const [agentChatsOpen, setAgentChatsOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectGoal, setProjectGoal] = useState('');
  const loading = convsLoading || projsLoading;
  // Every conversation that belongs to a project -- its context chat, threads
  // scoped to its tasks, and agent runs on them -- is listed under the
  // project. Only unscoped chats and unscoped runs stay in the flat groups.
  const projectOfConversation = useMemo(() => {
    const todoProject = new Map(todos.map((todo) => [todo.id, todo.project_id ?? null]));
    const rootProject = new Map(
      projects.flatMap((project) =>
        project.root_task_id ? [[project.root_task_id, project.id] as const] : [],
      ),
    );
    const byConversation = new Map<string, string>();
    for (const conversation of conversations) {
      const projectId =
        conversation.project_id ??
        (conversation.project_todo_id
          ? (rootProject.get(conversation.project_todo_id) ??
            todoProject.get(conversation.project_todo_id) ??
            null)
          : null);
      if (projectId) byConversation.set(conversation.id, projectId);
    }
    return byConversation;
  }, [conversations, projects, todos]);
  const agentChats = conversations.filter(
    (c) => c.metadata?.origin === 'agent_run' && !projectOfConversation.has(c.id),
  );
  const quickChats = conversations.filter(
    (c) => !projectOfConversation.has(c.id) && c.metadata?.origin !== 'agent_run',
  );
  // Compute per-project metadata
  const projectMeta = useMemo(() => {
    const rootTaskByProject = new Map(
      projects.map((project) => [project.id, project.root_task_id] as const),
    );
    const accumulators = new Map<
      string,
      {
        nextDue: string | null;
        nextDueTime: number;
        openCount: number;
        childCount: number;
      }
    >();
    for (const project of projects) {
      accumulators.set(project.id, {
        nextDue: null,
        nextDueTime: Number.POSITIVE_INFINITY,
        openCount: 0,
        childCount: 0,
      });
    }
    for (const todo of todos) {
      if (!todo.project_id) continue;
      const accumulator = accumulators.get(todo.project_id);
      if (!accumulator || todo.id === rootTaskByProject.get(todo.project_id)) continue;
      accumulator.childCount += 1;
      if (!isTerminalTaskStatus(todo.status)) {
        accumulator.openCount += 1;
        if (todo.due_date) {
          const dueTime = new Date(todo.due_date).getTime();
          if (dueTime < accumulator.nextDueTime) {
            accumulator.nextDue = todo.due_date;
            accumulator.nextDueTime = dueTime;
          }
        }
      }
    }
    const meta: Record<
      string,
      {
        nextDue: string | null;
        openCount: number;
        totalCount: number;
      }
    > = {};
    for (const project of projects) {
      const accumulator = accumulators.get(project.id)!;
      meta[project.id] = {
        nextDue: accumulator.nextDue,
        openCount: accumulator.openCount,
        totalCount: project.task_count ?? accumulator.childCount,
      };
    }
    return meta;
  }, [projects, todos]);
  const handleNewChat = async () => {
    try {
      const convo = await createConversationMutation.mutateAsync({});
      navigate(`/chats/${convo.id}`);
    } catch {
      // Stay on list page
    }
  };
  const handleProjectClick = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };
  const handleCreateProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectTitle.trim()) return;
    const project = await createProjectMutation.mutateAsync({
      title: projectTitle.trim(),
      goal: projectGoal.trim() || null,
    });
    setProjectTitle('');
    setProjectGoal('');
    setCreateProjectOpen(false);
    navigate(`/projects/${project.id}`);
  };
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    deleteConversationMutation.mutate(deleteTarget);
    setDeleteTarget(null);
  };
  return (
    <div>
      <div className="cc-projects-header">
        <div className="cc-page-header cc-page-header--flush">
          <div className="cc-page-header__title">
            {translateUi(projectsOnly ? 'Projects' : 'Chats')}
          </div>
          {!isMobile && (
            <div className="cc-page-header__subtitle">
              {translateUi(
                projectsOnly ? 'Your project workspaces' : 'Conversations outside projects',
              )}
            </div>
          )}
        </div>
        <div className="cc-projects-header__actions">
          {!projectsOnly && !isMobile && (
            <button type="button" className="cc-btn" onClick={handleNewChat}>
              {translateUi('\n              + Quick Chat\n            ')}
            </button>
          )}
          {projectsOnly && (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => setCreateProjectOpen(true)}
            >
              {translateUi('\n            + Project\n          ')}
            </button>
          )}
        </div>
      </div>

      {loading && projects.length === 0 && conversations.length === 0 && <ChatListSkeleton />}

      {/* Projects Section */}
      {projectsOnly && projects.length > 0 && (
        <div className="cc-projects-grid">
          {projects.map((project) => {
            const meta = projectMeta[project.id];
            const completedCount = project.completed_task_count ?? 0;
            const totalCount = meta?.totalCount ?? 0;
            return (
              <div key={project.id} className="cc-project-card-wrap">
                <button
                  type="button"
                  className="cc-project-card__delete"
                  aria-label={translateUi('Delete project {{title}}', { title: project.title })}
                  title={translateUi('Delete project')}
                  disabled={deleteProjectMutation.isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (
                      window.confirm(
                        translateUi('Delete “{{title}}”? Its tasks go back to the Inbox.', {
                          title: project.title,
                        }),
                      )
                    ) {
                      deleteProjectMutation.mutate(project.id);
                    }
                  }}
                >
                  <TrashIcon size={14} />
                </button>
                <ListRow
                  as="button"
                  type="button"
                  className="cc-project-card"
                  onClick={() => handleProjectClick(project.id)}
                >
                  <div className="cc-project-card__header">
                    <div className="cc-project-card__icon">{getProjectIcon(project.id)}</div>
                    <div className="cc-project-card__title-area">
                      <div className="cc-project-card__title">{project.title}</div>
                      {(project.goal || project.description) && (
                        <div className="cc-project-card__desc">
                          {(project.goal || project.description || '').slice(0, 80)}
                          {(project.goal || project.description || '').length > 80 ? '...' : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="cc-project-card__meta">
                    {totalCount > 0 && (
                      <span className="cc-project-card__tasks">
                        <CheckIcon size={14} />
                        {meta?.openCount ?? 0}/{totalCount}
                        {translateUi(' tasks\n                    ')}
                      </span>
                    )}
                    {meta?.nextDue && <Badge variant="due" dueDate={meta.nextDue} />}
                    <span className="cc-project-card__status">{project.status}</span>
                  </div>

                  {totalCount > 0 && (
                    <div className="cc-project-card__progress-track">
                      <div
                        className="cc-project-card__progress-bar"
                        style={{
                          width: `${totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  )}

                  <ChevronRightIcon className="cc-project-card__chevron" size={16} />
                </ListRow>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Conversations Section */}
      {!loading && projectsOnly && projects.length === 0 ? (
        <EmptyState
          icon={<ChatBubbleIcon size={20} />}
          message={translateUi('No projects yet. Create one to start a workspace.')}
        />
      ) : !projectsOnly && !loading && quickChats.length === 0 && agentChats.length === 0 ? (
        <EmptyState
          icon={<ChatBubbleIcon size={20} />}
          message={translateUi('No conversations outside projects yet.')}
        />
      ) : !projectsOnly && quickChats.length > 0 ? (
        <div className="cc-quick-chats">
          <button
            type="button"
            className="cc-quick-chats__toggle"
            onClick={() => setQuickChatsOpen(!quickChatsOpen)}
            aria-expanded={quickChatsOpen}
          >
            <ChevronRightIcon
              size={12}
              className={`cc-quick-chats__chevron${quickChatsOpen ? ' cc-quick-chats__chevron--open' : ''}`}
            />
            {translateUi('Recent chats')} ({quickChats.length})
          </button>
          {quickChatsOpen && (
            <div className="cc-quick-chats__list">
              {quickChats.map((convo) => (
                <ConversationItem
                  key={convo.id}
                  conversation={convo}
                  onClick={() => navigate(`/chats/${convo.id}`)}
                  onDelete={() => setDeleteTarget(convo.id)}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!projectsOnly && agentChats.length > 0 && (
        <div className="cc-quick-chats">
          <button
            type="button"
            className="cc-quick-chats__toggle"
            onClick={() => setAgentChatsOpen(!agentChatsOpen)}
            aria-expanded={agentChatsOpen}
          >
            <ChevronRightIcon
              size={12}
              className={`cc-quick-chats__chevron${agentChatsOpen ? ' cc-quick-chats__chevron--open' : ''}`}
            />
            {translateUi('Agent run conversations')} ({agentChats.length})
          </button>
          {agentChatsOpen && (
            <div className="cc-quick-chats__list">
              {agentChats.map((convo) => (
                <ConversationItem
                  key={convo.id}
                  conversation={convo}
                  onClick={() => navigate(`/chats/${convo.id}`)}
                  onDelete={() => setDeleteTarget(convo.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={translateUi('Delete Conversation')}
        description={translateUi(
          'Are you sure you want to delete this conversation? This action cannot be undone.',
        )}
        confirmLabel={translateUi('Delete')}
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
      <Dialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        title={translateUi('New Project')}
      >
        <form className="cc-project-form" onSubmit={handleCreateProject}>
          <label className="cc-project-form__field">
            <span>{translateUi('Title')}</span>
            <input
              autoFocus
              value={projectTitle}
              onChange={(event) => setProjectTitle(event.target.value)}
              placeholder={translateUi('What are you working toward?')}
            />
          </label>
          <label className="cc-project-form__field">
            <span>{translateUi('Goal')}</span>
            <textarea
              value={projectGoal}
              onChange={(event) => setProjectGoal(event.target.value)}
              placeholder={translateUi('Describe the outcome that defines success')}
              rows={3}
            />
          </label>
          <div className="cc-project-form__actions">
            <button type="button" className="cc-btn" onClick={() => setCreateProjectOpen(false)}>
              {translateUi('\n              Cancel\n            ')}
            </button>
            <button
              type="submit"
              className="cc-btn cc-btn--primary"
              disabled={!projectTitle.trim() || createProjectMutation.isPending}
            >
              {createProjectMutation.isPending
                ? translateUi('Creating\u2026')
                : translateUi('Create project')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
