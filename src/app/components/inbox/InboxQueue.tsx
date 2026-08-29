import EmptyState from '../shared/EmptyState';
import SectionHeader from '../shared/SectionHeader';
import TaskCard from '../shared/TaskCard';
import { InboxTrayIcon } from '../shared/Icons';
import type { ProjectResponse } from '../../types/api';
import InboxBatchBar from './InboxBatchBar';
import InboxCapturedCard from './InboxCapturedCard';
import InboxTriagePreviewPanel from './InboxTriagePreviewPanel';
import QuestionnaireCard from './QuestionnaireCard';
import {
  INBOX_TASK_BATCH_DRAG_TYPE,
  INBOX_TASK_DRAG_TYPE,
  transferHasType,
  transferredBatchTaskIds,
} from './inboxDragTransfer';
import type { InboxAiTriage } from './useInboxAiTriage';
import type { InboxSections } from './useInboxSections';
import type { InboxSelection } from './useInboxSelection';

interface InboxQueueProps {
  sections: InboxSections;
  selection: InboxSelection;
  triage: InboxAiTriage;
  projects: ProjectResponse[];
  graphRevisionReady: boolean;
  isPlacing: boolean;
  isBatchPlacing: boolean;
  dependencyBusy: boolean;
  isMobile: boolean;
  onUnplaceTask: (taskId: string) => void;
  onUnplaceTasks: (taskIds: string[]) => void;
  onToggleComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onOrganize: (taskId: string) => void;
  onRetry: (taskId: string) => void;
}

/** The triage queue: every Inbox pipeline stage plus the drop target that unplaces a task. */
export default function InboxQueue({
  sections,
  selection,
  triage,
  projects,
  graphRevisionReady,
  isPlacing,
  isBatchPlacing,
  dependencyBusy,
  isMobile,
  onUnplaceTask,
  onUnplaceTasks,
  onToggleComplete,
  onDelete,
  onOpenTask,
  onOrganize,
  onRetry,
}: InboxQueueProps) {
  const { processing, questioning, planReady, errors, needsOrganising, childCountByParent } =
    sections;
  const cardsDraggable = !isPlacing && !isBatchPlacing && !triage.isApplying;

  return (
    <main className="cc-inbox-triage__queue">
      <div
        className="cc-inbox-triage__inbox-target"
        onDragOver={(event) => {
          if (
            transferHasType(event, INBOX_TASK_DRAG_TYPE) ||
            transferHasType(event, INBOX_TASK_BATCH_DRAG_TYPE)
          ) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          const batchIds = transferredBatchTaskIds(event);
          if (batchIds.length > 1 && !isBatchPlacing) {
            event.preventDefault();
            onUnplaceTasks(batchIds);
            return;
          }
          const taskId = event.dataTransfer.getData(INBOX_TASK_DRAG_TYPE);
          if (taskId && !isPlacing) {
            event.preventDefault();
            onUnplaceTask(taskId);
          }
        }}
      >
        Inbox · drop here to unplace
      </div>
      {/* Planning now (classifying/planning) */}
      {processing.length > 0 && (
        <SectionHeader title="Planning now" count={processing.length} variant="default" defaultOpen>
          {processing.map((task) => (
            <div key={task.id} className="cc-inbox-card cc-inbox-card--planning">
              <div className="cc-inbox-card__spinner" />
              <TaskCard
                task={task}
                onToggle={() => onToggleComplete(task.id)}
                onClick={() => onOpenTask(task.id)}
                onDelete={() => onDelete(task.id)}
              />
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Answer questions (questioning) */}
      {questioning.length > 0 && (
        <SectionHeader
          title="Answer questions"
          count={questioning.length}
          variant="accent"
          defaultOpen
        >
          {questioning.map((task) => (
            <QuestionnaireCard key={task.id} task={task} />
          ))}
        </SectionHeader>
      )}

      {/* Review suggestion (plan_ready) */}
      {planReady.length > 0 && (
        <SectionHeader
          title="Review suggestion"
          count={planReady.length}
          variant="accent"
          defaultOpen
        >
          {planReady.map((task) => (
            <div key={task.id} className="cc-inbox-card cc-inbox-card--review">
              <TaskCard
                task={task}
                onToggle={() => onToggleComplete(task.id)}
                onClick={() => onOpenTask(task.id)}
                onDelete={() => onDelete(task.id)}
              />
              <div className="cc-inbox-card__actions">
                <button
                  className="cc-btn cc-btn--primary"
                  style={{ fontSize: 12 }}
                  onClick={() => onOpenTask(task.id)}
                >
                  Review
                </button>
              </div>
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Needs organizing (captured) */}
      {needsOrganising.length > 0 && (
        <SectionHeader
          title="Needs organizing"
          count={needsOrganising.length}
          variant="accent"
          defaultOpen
        >
          <InboxBatchBar
            selectedCount={selection.batchTaskIds.length}
            totalCount={needsOrganising.length}
            suggestDisabled={
              selection.batchTaskIds.length === 0 ||
              !graphRevisionReady ||
              triage.isSuggesting ||
              triage.isApplying
            }
            isSuggesting={triage.isSuggesting}
            onSuggest={() => void triage.requestPreview()}
            onSelectAll={selection.selectAllForBatch}
            onClear={selection.clearBatchSelection}
          />
          {triage.preview && (
            <InboxTriagePreviewPanel
              preview={triage.preview}
              projects={projects}
              todoById={sections.todoById}
              selectedTaskIds={triage.selectedTaskIds}
              isApplying={triage.isApplying}
              onToggleSuggestion={triage.toggleSuggestion}
              onDismiss={triage.dismissPreview}
              onApply={() => void triage.applyPreview()}
            />
          )}
          {needsOrganising.map((task) => (
            <InboxCapturedCard
              key={task.id}
              task={task}
              isSelected={selection.selectedTaskId === task.id}
              isBatchSelected={selection.batchTaskIds.includes(task.id)}
              batchTaskIds={selection.batchTaskIds}
              subTaskCount={childCountByParent.get(task.id) ?? 0}
              draggable={cardsDraggable}
              dependencyDraggable={!dependencyBusy}
              onSelect={selection.selectTask}
              onToggleBatch={selection.toggleBatchTask}
              onToggleComplete={onToggleComplete}
              onDelete={onDelete}
              onOrganize={onOrganize}
            />
          ))}
        </SectionHeader>
      )}

      {/* Failed (error) */}
      {errors.length > 0 && (
        <SectionHeader title="Failed" count={errors.length} variant="warning" defaultOpen={false}>
          {errors.map((task) => (
            <div key={task.id} className="cc-inbox-card cc-inbox-card--error">
              <TaskCard
                task={task}
                onToggle={() => onToggleComplete(task.id)}
                onClick={() => onOpenTask(task.id)}
                onDelete={() => onDelete(task.id)}
              />
              <div className="cc-inbox-card__actions">
                <button
                  className="cc-btn cc-btn--danger"
                  style={{ fontSize: 12 }}
                  onClick={() => onRetry(task.id)}
                >
                  Retry
                </button>
              </div>
            </div>
          ))}
        </SectionHeader>
      )}

      {sections.totalItems === 0 && (
        <EmptyState
          icon={<InboxTrayIcon size={20} />}
          message={
            isMobile
              ? 'Inbox is clear. Add something when it comes up.'
              : 'Inbox is clear. Capture a task or note when something comes up.'
          }
        />
      )}
    </main>
  );
}
