import { useState, useEffect, useMemo } from 'react';
import usePlatform from '../hooks/usePlatform';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/useChatStore';
import { useModuleStore } from '../stores/useModuleStore';
import ConversationItem from '../components/shared/ConversationItem';
import EmptyState from '../components/shared/EmptyState';
import Badge from '../components/shared/Badge';
import { ChatBubbleIcon } from '../components/shared/Icons';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { ChatListSkeleton } from '../components/shared/PageSkeletons';
import { getProjectIcon } from '../utils/projectIcons';
import type { ProjectTodoResponse } from '../types/api';

function getNextDueDate(project: ProjectTodoResponse, todos: ReturnType<typeof useModuleStore.getState>['todos']): string | null {
  const children = todos.filter((t) => t.parent_id === project.id && t.status !== 'completed' && t.due_date);
  if (children.length === 0) return null;
  children.sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
  return children[0].due_date!;
}

function getSyncBadge(project: ProjectTodoResponse): { label: string; variant: 'synced' | 'linked' | 'none' } {
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
  const conversations = useChatStore((s) => s.conversations);
  const conversationsLoaded = useChatStore((s) => s.conversationsLoaded);
  const projects = useChatStore((s) => s.projects);
  const projectsLoaded = useChatStore((s) => s.projectsLoaded);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const fetchProjects = useChatStore((s) => s.fetchProjects);
  const getOrCreateProjectConversation = useChatStore((s) => s.getOrCreateProjectConversation);
  const todos = useModuleStore((s) => s.todos);
  const { isMobile } = usePlatform();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [quickChatsOpen, setQuickChatsOpen] = useState(false);

  useEffect(() => {
    if (!projectsLoaded) fetchProjects();
  }, [projectsLoaded, fetchProjects]);

  const loading = !conversationsLoaded || !projectsLoaded;

  // Quick chats = conversations without a project_todo_id
  const quickChats = conversations.filter((c) => !c.project_todo_id);

  // Compute per-project metadata
  const projectMeta = useMemo(() => {
    const meta: Record<string, { nextDue: string | null; openCount: number; totalCount: number }> = {};
    for (const project of projects) {
      const children = todos.filter((t) => t.parent_id === project.id);
      const openCount = children.filter((t) => t.status !== 'completed').length;
      meta[project.id] = {
        nextDue: getNextDueDate(project, todos),
        openCount,
        totalCount: project.subtask_count ?? children.length,
      };
    }
    return meta;
  }, [projects, todos]);

  const handleNewChat = async () => {
    try {
      const convo = await createConversation();
      navigate(`/chats/${convo.id}`);
    } catch {
      // Stay on list page
    }
  };

  const handleProjectClick = async (todoId: string) => {
    try {
      const convo = await getOrCreateProjectConversation(todoId);
      navigate(`/chats/${convo.id}`);
    } catch {
      // Stay on list page
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await deleteConversation(deleteTarget);
    setDeleteTarget(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? 12 : 16 }}>
        <div className="cc-page-header" style={{ marginBottom: 0 }}>
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
                  <div className="cc-project-card__icon">
                    {getProjectIcon(project.id)}
                  </div>
                  <div className="cc-project-card__title-area">
                    <div className="cc-project-card__title">{project.title}</div>
                    {project.description && (
                      <div className="cc-project-card__desc">
                        {project.description.slice(0, 80)}{project.description.length > 80 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </div>

                <div className="cc-project-card__meta">
                  {totalCount > 0 && (
                    <span className="cc-project-card__tasks">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 5l-7 7L3 8.5" />
                      </svg>
                      {meta?.openCount ?? 0}/{totalCount} tasks
                    </span>
                  )}
                  {meta?.nextDue && (
                    <Badge variant="due" dueDate={meta.nextDue} />
                  )}
                  {sync.variant !== 'none' && (
                    <span className={`cc-project-card__sync cc-project-card__sync--${sync.variant}`}>
                      {sync.variant === 'synced' && (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13.5 5l-7 7L3 8.5" />
                        </svg>
                      )}
                      {sync.variant === 'linked' && (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 13V3a1 1 0 011-1h4l2 2h4a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
                        </svg>
                      )}
                      {sync.label}
                    </span>
                  )}
                </div>

                {totalCount > 0 && (
                  <div className="cc-project-card__progress-track">
                    <div
                      className="cc-project-card__progress-bar"
                      style={{ width: `${totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%` }}
                    />
                  </div>
                )}

                <svg className="cc-project-card__chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--cc-text-tertiary)" strokeWidth="1.5">
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Conversations Section */}
      {!loading && projects.length === 0 && quickChats.length === 0 ? (
        <EmptyState icon={<ChatBubbleIcon size={20} />} message={isMobile ? 'No projects yet.' : 'No projects or conversations yet. Create a root-level todo to start a project!'} />
      ) : quickChats.length > 0 ? (
        <div className="cc-quick-chats">
          <button
            type="button"
            className="cc-quick-chats__toggle"
            onClick={() => setQuickChatsOpen(!quickChatsOpen)}
          >
            <svg
              width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transform: quickChatsOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            >
              <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Quick conversations ({quickChats.length})
          </button>
          {quickChatsOpen && (
            <div className="cc-quick-chats__list" style={{ height: isMobile ? 'calc(100vh - 340px)' : 'calc(100vh - 360px)', overflowY: 'auto' }}>
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
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
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
