interface SegmentedControlProps {
  ariaLabel: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}

export default function SegmentedControl({ ariaLabel, options, value, onChange }: SegmentedControlProps) {
  return (
    <div className="cc-segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`cc-segmented__option${opt.value === value ? ' cc-segmented__option--active' : ''}`}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
