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
/** The one-line multi-select toolbar above the captured tasks. */
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
    <div
      className="cc-inbox-triage__batch-bar"
      data-active={selectedCount > 0 ? 'true' : undefined}
      aria-live="polite"
    >
      <span>
        {selectedCount
          ? translateUi('{{count}} selected', { count: selectedCount })
          : translateUi('Select tasks to move them together')}
      </span>
      <div>
        <button
          type="button"
          className="cc-btn cc-btn--compact cc-btn--ghost"
          disabled={selectedCount === totalCount}
          onClick={onSelectAll}
        >
          {translateUi('Select all')}
        </button>
        {selectedCount > 0 && (
          <button type="button" className="cc-btn cc-btn--compact cc-btn--ghost" onClick={onClear}>
            {translateUi('Clear')}
          </button>
        )}
        <button
          type="button"
          className="cc-btn cc-btn--compact cc-btn--primary"
          disabled={suggestDisabled}
          onClick={onSuggest}
        >
          {isSuggesting ? translateUi('Suggesting…') : translateUi('AI suggest')}
        </button>
      </div>
    </div>
  );
}
