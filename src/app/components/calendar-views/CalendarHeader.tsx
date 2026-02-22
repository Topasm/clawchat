import SegmentedControl from '../shared/SegmentedControl';
import type { ViewMode } from '../../hooks/useCalendarNavigation';

interface CalendarHeaderProps {
  headerLabel: string;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export default function CalendarHeader({
  headerLabel,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
}: CalendarHeaderProps) {
  return (
    <div className="cc-calendar__header">
      <div className="cc-calendar__header-left">
        <h1 className="cc-page-header__title cc-calendar__title">{headerLabel}</h1>
        <div className="cc-calendar__nav">
          <button type="button" className="cc-btn cc-btn--ghost cc-calendar__nav-btn" onClick={onPrev} aria-label="Previous">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
          <button type="button" className="cc-btn cc-btn--ghost cc-calendar__today-btn" onClick={onToday}>
            Today
          </button>
          <button type="button" className="cc-btn cc-btn--ghost cc-calendar__nav-btn" onClick={onNext} aria-label="Next">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        </div>
      </div>
      <div className="cc-calendar__header-right">
        <SegmentedControl
          options={[
            { label: 'Month', value: 'month' },
            { label: 'Week', value: 'week' },
          ]}
          value={view}
          onChange={(v) => onViewChange(v as ViewMode)}
        />
      </div>
    </div>
  );
}
