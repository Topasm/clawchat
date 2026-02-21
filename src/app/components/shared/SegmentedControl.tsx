interface SegmentedControlProps {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}

export default function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  return (
    <div className="cc-segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`cc-segmented__option${opt.value === value ? ' cc-segmented__option--active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
