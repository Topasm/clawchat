import { AnimatePresence, motion } from 'framer-motion';
import { useModuleStore } from '../../stores/useModuleStore';

export default function BulkActionToolbar() {
  const selectedIds = useModuleStore((s) => s.selectedTodoIds);
  const clearSelection = useModuleStore((s) => s.clearTodoSelection);
  const bulkUpdate = useModuleStore((s) => s.bulkUpdateTodos);

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
          <span className="cc-bulk-toolbar__count">{count} selected</span>

          <select
            className="cc-bulk-toolbar__select"
            value=""
            onChange={(e) => {
              if (e.target.value) bulkUpdate({ ids, status: e.target.value });
            }}
          >
            <option value="">Set Status</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
          </select>

          <select
            className="cc-bulk-toolbar__select"
            value=""
            onChange={(e) => {
              if (e.target.value) bulkUpdate({ ids, priority: e.target.value });
            }}
          >
            <option value="">Set Priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <button
            className="cc-btn cc-btn--danger"
            onClick={() => bulkUpdate({ ids, delete: true })}
          >
            Delete
          </button>

          <button className="cc-btn cc-btn--ghost" onClick={clearSelection}>
            Cancel
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
