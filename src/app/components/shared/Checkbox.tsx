interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
}

export default function Checkbox({ checked, onChange }: CheckboxProps) {
  return (
    <div
      className={`cc-checkbox${checked ? ' cc-checkbox--checked' : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      role="checkbox"
      aria-checked={checked}
    >
      {checked && (
        <svg className="cc-checkbox__check" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}
