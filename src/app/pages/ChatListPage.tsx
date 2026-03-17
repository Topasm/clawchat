import { useState, useEffect } from 'react';
import usePlatform from '../hooks/usePlatform';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/useChatStore';
import ConversationItem from '../components/shared/ConversationItem';
import EmptyState from '../components/shared/EmptyState';
import { ChatBubbleIcon } from '../components/shared/Icons';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { ChatListSkeleton } from '../components/shared/PageSkeletons';
import { getProjectIcon } from '../utils/projectIcons';

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
  const { isMobile } = usePlatform();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [quickChatsOpen, setQuickChatsOpen] = useState(false);

  useEffect(() => {
    if (!projectsLoaded) fetchProjects();
  }, [projectsLoaded, fetchProjects]);

  const loading = !conversationsLoaded || !projectsLoaded;

  // Quick chats = conversations without a project_todo_id
  const quickChats = conversations.filter((c) => !c.project_todo_id);

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
          {!isMobile && <div className="cc-page-header__subtitle">Project conversations &amp; quick chats</div>}
        </div>
        <button type="button" className="cc-btn cc-btn--primary" onClick={handleNewChat}>
          {isMobile ? '+ New' : '+ Quick Chat'}
        </button>
      </div>

      {loading && projects.length === 0 && conversations.length === 0 && <ChatListSkeleton />}

      {/* Projects Section */}
      {projects.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--cc-text-secondary)', marginBottom: 8 }}>
            Projects
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="cc-project-item"
                onClick={() => handleProjectClick(project.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: 'var(--cc-surface)',
                  border: '1px solid var(--cc-border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--cc-surface-secondary)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--cc-surface)'; }}
              >
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'var(--cc-primary-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 20,
                  lineHeight: 1,
                }}>
                  {getProjectIcon(project.id)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: 'var(--cc-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {project.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--cc-text-tertiary)', marginTop: 2 }}>
                    {project.description
                      ? project.description.slice(0, 60) + (project.description.length > 60 ? '...' : '')
                      : 'No description'}
                    {project.subtask_count != null && project.subtask_count > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        {project.completed_subtask_count ?? 0}/{project.subtask_count} tasks
                      </span>
                    )}
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--cc-text-tertiary)" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Chats Section */}
      {!loading && projects.length === 0 && quickChats.length === 0 ? (
        <EmptyState icon={<ChatBubbleIcon size={20} />} message={isMobile ? 'No projects yet.' : 'No projects or conversations yet. Create a root-level todo to start a project!'} />
      ) : quickChats.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setQuickChatsOpen(!quickChatsOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--cc-text-secondary)',
              marginBottom: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <svg
              width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transform: quickChatsOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            >
              <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Quick Chats ({quickChats.length})
          </button>
          {quickChatsOpen && (
            <div style={{ height: isMobile ? 'calc(100vh - 340px)' : 'calc(100vh - 360px)', overflowY: 'auto' }}>
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
