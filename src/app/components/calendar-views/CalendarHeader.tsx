import SegmentedControl from '../shared/SegmentedControl';
import { ChevronLeftIcon, ChevronRightIcon } from '../shared/Icons';
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
            <ChevronLeftIcon size={16} />
          </button>
          <button type="button" className="cc-btn cc-btn--ghost cc-calendar__today-btn" onClick={onToday}>
            Today
          </button>
          <button type="button" className="cc-btn cc-btn--ghost cc-calendar__nav-btn" onClick={onNext} aria-label="Next">
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </div>
      <div className="cc-calendar__header-right">
        <SegmentedControl
          ariaLabel="Calendar view"
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
