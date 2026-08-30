import { CheckIcon } from './Icons';
import { translateUi } from '../../i18n';
interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
}
export default function Checkbox({ checked, onChange }: CheckboxProps) {
  return (
    <button
      type="button"
      className={`cc-checkbox${checked ? ' cc-checkbox--checked' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? translateUi('Mark incomplete') : translateUi('Mark complete')}
    >
      {checked && <CheckIcon className="cc-checkbox__check" size={12} />}
    </button>
  );
}
