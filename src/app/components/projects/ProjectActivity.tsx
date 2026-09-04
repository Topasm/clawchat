import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentRunsQuery, useConversationsQuery, useReviewsQuery } from '../../hooks/queries';
import type { ConversationResponse, ProjectOverviewResponse, TodoResponse } from '../../types/api';
import { translateUi } from '../../i18n';
import { useChatPanelController } from '../chat-panel/ChatPanelControllerContext';
import { runStatusLabel } from '../chat-panel/RunStatusCard';
import EmptyState from '../shared/EmptyState';

const ACTIVE_STATUSES = new Set([
  'queued',
  'starting',
  'running',
  'waiting_input',
  'waiting_review',
]);

export default function ProjectActivity({
  project,
  todos,
}: {
  project: ProjectOverviewResponse;
  todos: TodoResponse[];
}) {
  const navigate = useNavigate();
  const panel = useChatPanelController();
  const { data: runs = [] } = useAgentRunsQuery(project.id);
  const { data: reviews = [] } = useReviewsQuery('pending', project.id);
  const { data: conversations = [] } = useConversationsQuery();
  const todoById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const projectThreads = useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          conversation.project_id === project.id ||
          (conversation.project_todo_id
            ? todoById.get(conversation.project_todo_id)?.project_id === project.id
            : false),
      ),
    [conversations, project.id, todoById],
  );
  const activeRuns = runs.filter((run) => ACTIVE_STATUSES.has(run.status));
  const openThread = (conversation: ConversationResponse) => {
    const metadataTodoId =
      typeof conversation.metadata?.todo_id === 'string' ? conversation.metadata.todo_id : null;
    const taskId =
      metadataTodoId ??
      (conversation.project_todo_id !== project.root_task_id ? conversation.project_todo_id : null);
    const task = taskId ? todoById.get(taskId) : null;
    const isRun = conversation.metadata?.origin === 'agent_run';
    panel.open(conversation.id, {
      kind: isRun ? 'run' : task ? 'task' : 'project',
      title: isRun || task ? 'Task Agent' : 'Project Agent',
      subtitle: task ? `${project.title} › ${task.title}` : project.title,
    });
  };

  if (activeRuns.length === 0 && reviews.length === 0 && projectThreads.length === 0) {
    return (
      <EmptyState
        icon={<span>◎</span>}
        message={translateUi(
          'No project activity yet. Start a Ready task or talk to Project Agent.',
        )}
      />
    );
  }

  return (
    <div className="cc-project-activity">
      {(reviews.length > 0 || activeRuns.some((run) => run.status === 'waiting_input')) && (
        <section className="cc-project-workspace__section">
          <div className="cc-project-workspace__section-header">
            <div>
              <h2>{translateUi('Needs attention')}</h2>
              <p>{translateUi('Agent questions and results waiting for you.')}</p>
            </div>
          </div>
          <div className="cc-project-activity__list">
            {activeRuns
              .filter((run) => run.status === 'waiting_input')
              .map((run) => (
                <button
                  type="button"
                  key={run.id}
                  onClick={() => {
                    const conversation = projectThreads.find(
                      (thread) => thread.id === run.conversation_id,
                    );
                    if (conversation) openThread(conversation);
                    else navigate(`/runs?run_id=${run.id}`);
                  }}
                >
                  <span>
                    <strong>{run.todo_title || run.instruction}</strong>
                    <small>{translateUi('Agent is waiting for your answer')}</small>
                  </span>
                  <span>{translateUi('Open thread')}</span>
                </button>
              ))}
            {reviews.map((review) => (
              <button
                type="button"
                key={review.id}
                onClick={() => navigate(`/review?project_id=${project.id}`)}
              >
                <span>
                  <strong>{review.subject_title || review.summary}</strong>
                  <small>{translateUi('Ready for review')}</small>
                </span>
                <span>{translateUi('Review')}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeRuns.length > 0 && (
        <section className="cc-project-workspace__section">
          <div className="cc-project-workspace__section-header">
            <div>
              <h2>{translateUi('Agent runs')}</h2>
              <p>{translateUi('Current work for this project.')}</p>
            </div>
          </div>
          <div className="cc-project-activity__list">
            {activeRuns.map((run) => (
              <button
                type="button"
                key={run.id}
                onClick={() => {
                  const conversation = projectThreads.find(
                    (thread) => thread.id === run.conversation_id,
                  );
                  if (conversation) openThread(conversation);
                  else navigate(`/runs?run_id=${run.id}`);
                }}
              >
                <span>
                  <strong>{run.todo_title || run.instruction}</strong>
                  <small>{run.progress_message || runStatusLabel(run.status)}</small>
                </span>
                <span>{run.progress}%</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {projectThreads.length > 0 && (
        <section className="cc-project-workspace__section">
          <div className="cc-project-workspace__section-header">
            <div>
              <h2>{translateUi('Task threads')}</h2>
              <p>{translateUi('Project planning and task execution conversations.')}</p>
            </div>
          </div>
          <div className="cc-project-activity__list">
            {projectThreads.map((conversation) => (
              <button type="button" key={conversation.id} onClick={() => openThread(conversation)}>
                <span>
                  <strong>{conversation.title || translateUi('Conversation')}</strong>
                  <small>
                    {conversation.metadata?.origin === 'agent_run'
                      ? translateUi('Task Agent')
                      : conversation.project_todo_id === project.root_task_id
                        ? translateUi('Project Agent')
                        : translateUi('Task thread')}
                  </small>
                </span>
                <span>{translateUi('Open')}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
