interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

export default function Slider({ value, min, max, step = 1, onChange, formatValue }: SliderProps) {
  return (
    <div className="cc-slider">
      <input
        type="range"
        className="cc-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="cc-slider__value">
        {formatValue ? formatValue(value) : value}
      </span>
    </div>
  );
}
