import { translateUi } from '../../i18n';
interface InboxBatchBarProps {
  selectedCount: number;
  totalCount: number;
  suggestDisabled: boolean;
  isSuggesting: boolean;
  onSuggest: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}
/** The multi-select toolbar above the captured tasks. */
export default function InboxBatchBar({
  selectedCount,
  totalCount,
  suggestDisabled,
  isSuggesting,
  onSuggest,
  onSelectAll,
  onClear,
}: InboxBatchBarProps) {
  return (
    <div className="cc-inbox-triage__batch-bar" aria-live="polite">
      <span>
        {selectedCount
          ? translateUi('{{count}} selected', { count: selectedCount })
          : translateUi('Select tasks to move them together')}
      </span>
      <div>
        <button
          type="button"
          className="cc-btn cc-btn--secondary"
          disabled={suggestDisabled}
          onClick={onSuggest}
        >
          {isSuggesting ? translateUi('Suggesting\u2026') : translateUi('AI suggest')}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          disabled={selectedCount === totalCount}
          onClick={onSelectAll}
        >
          {translateUi('\n          Select all\n        ')}
        </button>
        {selectedCount > 0 && (
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onClear}>
            {translateUi('\n            Clear\n          ')}
          </button>
        )}
      </div>
    </div>
  );
}
