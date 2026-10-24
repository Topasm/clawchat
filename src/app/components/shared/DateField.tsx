import { useRef, useState, type FocusEvent } from 'react';
import { formatDate } from '../../utils/formatters';
import { useTranslation } from '../../i18n';

interface DateFieldProps {
  /** `YYYY-MM-DD`, or empty for no date. */
  value: string;
  onChange: (value: string) => void;
  /** The field's name for screen readers, unless a `<label htmlFor>` names it. */
  'aria-label'?: string;
  id?: string;
  className?: string;
  /** What the field says while it has no date. */
  placeholder?: string;
  min?: string;
  max?: string;
}

/**
 * A date editor that prints its date the way the rest of the app does
 * ("10월 25일", not "10/25/2026").
 *
 * Browsers print a native date input in the system's locale and ignore
 * `lang`, so the native input is kept for its picker and keyboard editing
 * while the words shown come from `formatDate`. A pointer opens the picker;
 * keyboard focus shows the native segments, since typing into words you cannot
 * see would be worse than the locale mismatch.
 */
export default function DateField({
  value,
  onChange,
  id,
  className,
  placeholder,
  min,
  max,
  ...labels
}: DateFieldProps) {
  const { tr } = useTranslation();
  const pointer = useRef(false);
  const [keyboard, setKeyboard] = useState(false);

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    if (!pointer.current) {
      setKeyboard(true);
    } else if ('showPicker' in event.currentTarget) {
      try {
        (event.currentTarget as HTMLInputElement & { showPicker(): void }).showPicker();
      } catch {
        // Needs a user gesture, or the platform has no picker: the native input is still usable.
      }
    }
    pointer.current = false;
  };

  const text = value ? formatDate(`${value}T00:00:00`) : placeholder || tr('Set date');

  return (
    <span
      className={`cc-date-field${keyboard ? ' cc-date-field--keyboard' : ''}${value ? '' : ' cc-date-field--empty'}${className ? ` ${className}` : ''}`}
    >
      <span className="cc-date-field__text" aria-hidden="true">
        {text}
      </span>
      <input
        id={id}
        type="date"
        className="cc-date-field__native"
        aria-label={labels['aria-label']}
        value={value}
        min={min}
        max={max}
        onPointerDown={() => {
          pointer.current = true;
        }}
        onFocus={handleFocus}
        onBlur={() => setKeyboard(false)}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}
