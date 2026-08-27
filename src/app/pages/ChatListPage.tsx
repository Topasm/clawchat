import { useState, useMemo } from 'react';
import usePlatform from '../hooks/usePlatform';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/useChatStore';
import {
  useConversationsQuery,
  useProjectsQuery,
  useTodosQuery,
  useCreateConversation,
  useDeleteConversation,
  useGetOrCreateProjectConversation,
} from '../hooks/queries';
import ConversationItem from '../components/shared/ConversationItem';
import EmptyState from '../components/shared/EmptyState';
import Badge from '../components/shared/Badge';
import {
  ChatBubbleIcon,
  CheckIcon,
  ChevronRightIcon,
  FolderIcon,
} from '../components/shared/Icons';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { ChatListSkeleton } from '../components/shared/PageSkeletons';
import { getProjectIcon } from '../utils/projectIcons';
import type { ProjectTodoResponse } from '../types/api';

function getSyncBadge(project: ProjectTodoResponse): {
  label: string;
  variant: 'synced' | 'linked' | 'none';
} {
  if (project.source === 'obsidian_project' || project.source === 'obsidian') {
    return { label: 'Synced', variant: 'synced' };
  }
  if (project.source_id) {
    return { label: 'Linked folder', variant: 'linked' };
  }
  return { label: '', variant: 'none' };
}

export default function ChatListPage() {
  const navigate = useNavigate();
  const { data: conversations = [], isLoading: convsLoading } = useConversationsQuery();
  const { data: projects = [], isLoading: projsLoading } = useProjectsQuery();
  const { data: todos = [] } = useTodosQuery();
  const createConversationMutation = useCreateConversation();
  const deleteConversationMutation = useDeleteConversation();
  const getOrCreateProjectConvMutation = useGetOrCreateProjectConversation();
  const { isMobile } = usePlatform();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [quickChatsOpen, setQuickChatsOpen] = useState(false);

  const loading = convsLoading || projsLoading;

  // Quick chats = conversations without a project_todo_id
  const quickChats = conversations.filter((c) => !c.project_todo_id);

  // Compute per-project metadata
  const projectMeta = useMemo(() => {
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
      if (!todo.parent_id) continue;
      const accumulator = accumulators.get(todo.parent_id);
      if (!accumulator) continue;

      accumulator.childCount += 1;
      if (todo.status !== 'completed') {
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

    const meta: Record<string, { nextDue: string | null; openCount: number; totalCount: number }> =
      {};
    for (const project of projects) {
      const accumulator = accumulators.get(project.id)!;
      meta[project.id] = {
        nextDue: accumulator.nextDue,
        openCount: accumulator.openCount,
        totalCount: project.subtask_count ?? accumulator.childCount,
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

  const handleProjectClick = async (todoId: string) => {
    try {
      const convo = await getOrCreateProjectConvMutation.mutateAsync(todoId);
      navigate(`/chats/${convo.id}`);
    } catch {
      // Stay on list page
    }
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
          <div className="cc-page-header__title">Projects</div>
          {!isMobile && <div className="cc-page-header__subtitle">Your project workspaces</div>}
        </div>
        {!isMobile && (
          <button type="button" className="cc-btn cc-btn--primary" onClick={handleNewChat}>
            + Quick Chat
          </button>
        )}
      </div>

      {loading && projects.length === 0 && conversations.length === 0 && <ChatListSkeleton />}

      {/* Projects Section */}
      {projects.length > 0 && (
        <div className="cc-projects-grid">
          {projects.map((project) => {
            const meta = projectMeta[project.id];
            const sync = getSyncBadge(project);
            const completedCount = project.completed_subtask_count ?? 0;
            const totalCount = meta?.totalCount ?? 0;

            return (
              <button
                key={project.id}
                type="button"
                className="cc-project-card"
                onClick={() => handleProjectClick(project.id)}
              >
                <div className="cc-project-card__header">
                  <div className="cc-project-card__icon">{getProjectIcon(project.id)}</div>
                  <div className="cc-project-card__title-area">
                    <div className="cc-project-card__title">{project.title}</div>
                    {project.description && (
                      <div className="cc-project-card__desc">
                        {project.description.slice(0, 80)}
                        {project.description.length > 80 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </div>

                <div className="cc-project-card__meta">
                  {totalCount > 0 && (
                    <span className="cc-project-card__tasks">
                      <CheckIcon size={14} />
                      {meta?.openCount ?? 0}/{totalCount} tasks
                    </span>
                  )}
                  {meta?.nextDue && <Badge variant="due" dueDate={meta.nextDue} />}
                  {sync.variant !== 'none' && (
                    <span
                      className={`cc-project-card__sync cc-project-card__sync--${sync.variant}`}
                    >
                      {sync.variant === 'synced' && <CheckIcon size={12} />}
                      {sync.variant === 'linked' && <FolderIcon size={12} />}
                      {sync.label}
                    </span>
                  )}
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
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Conversations Section */}
      {!loading && projects.length === 0 && quickChats.length === 0 ? (
        <EmptyState
          icon={<ChatBubbleIcon size={20} />}
          message={
            isMobile
              ? 'No projects yet.'
              : 'No projects or conversations yet. Create a root-level todo to start a project!'
          }
        />
      ) : quickChats.length > 0 ? (
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
            Quick conversations ({quickChats.length})
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Conversation"
        description="Are you sure you want to delete this conversation? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
