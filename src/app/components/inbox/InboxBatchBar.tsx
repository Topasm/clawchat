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
        {selectedCount ? `${selectedCount} selected` : 'Select tasks to move them together'}
      </span>
      <div>
        <button
          type="button"
          className="cc-btn cc-btn--secondary"
          disabled={suggestDisabled}
          onClick={onSuggest}
        >
          {isSuggesting ? 'Suggesting…' : 'AI suggest'}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          disabled={selectedCount === totalCount}
          onClick={onSelectAll}
        >
          Select all
        </button>
        {selectedCount > 0 && (
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
