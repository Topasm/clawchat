import { AnimatePresence, motion } from 'framer-motion';
import { useModuleStore } from '../../stores/useModuleStore';
import { useBulkUpdateTodos } from '../../hooks/queries';
import type { TodoResponse } from '../../types/api';
import { TaskStatusSchema } from '../../types/schemas';
import { translateUi } from '../../i18n';
export default function BulkActionToolbar() {
  const selectedIds = useModuleStore((s) => s.selectedTodoIds);
  const clearSelection = useModuleStore((s) => s.clearTodoSelection);
  const bulkUpdateMutation = useBulkUpdateTodos();
  const bulkUpdate = (data: Parameters<typeof bulkUpdateMutation.mutate>[0]) =>
    bulkUpdateMutation.mutate(data);
  const count = selectedIds.size;
  const ids = Array.from(selectedIds);
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          className="cc-bulk-toolbar"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        >
          <span className="cc-bulk-toolbar__count">
            {count}
            {translateUi(' selected')}
          </span>

          <select
            className="cc-bulk-toolbar__select"
            value=""
            onChange={(e) => {
              const status = TaskStatusSchema.safeParse(e.target.value);
              if (status.success) bulkUpdate({ ids, status: status.data });
            }}
          >
            <option value="">{translateUi('Set Status')}</option>
            <option value="pending">{translateUi('Pending')}</option>
            <option value="in_progress">{translateUi('In Progress')}</option>
            <option value="completed">{translateUi('Completed')}</option>
            <option value="cancelled">{translateUi('Cancelled')}</option>
          </select>

          <select
            className="cc-bulk-toolbar__select"
            value=""
            onChange={(e) => {
              if (e.target.value)
                bulkUpdate({
                  ids,
                  priority: e.target.value as NonNullable<TodoResponse['priority']>,
                });
            }}
          >
            <option value="">{translateUi('Set Priority')}</option>
            <option value="urgent">{translateUi('Urgent')}</option>
            <option value="high">{translateUi('High')}</option>
            <option value="medium">{translateUi('Medium')}</option>
            <option value="low">{translateUi('Low')}</option>
          </select>

          <button
            className="cc-btn cc-btn--danger"
            onClick={() => bulkUpdate({ ids, delete: true })}
          >
            {translateUi('\n            Delete\n          ')}
          </button>

          <button className="cc-btn cc-btn--ghost" onClick={clearSelection}>
            {translateUi('\n            Cancel\n          ')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
