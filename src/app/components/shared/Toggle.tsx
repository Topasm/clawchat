interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export default function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      className={`cc-toggle ${checked ? 'cc-toggle--on' : 'cc-toggle--off'}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <div className="cc-toggle__knob" />
    </button>
  );
}
