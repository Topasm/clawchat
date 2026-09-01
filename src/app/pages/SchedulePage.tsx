import { useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import CalendarContainer from '../components/calendar-views/CalendarContainer';
import SegmentedControl from '../components/shared/SegmentedControl';
import TodayContainer from '../components/today-views/TodayContainer';
import { useTranslation } from '../i18n';

export type ScheduleView = 'today' | 'week' | 'month';

export const SCHEDULE_VIEWS: ScheduleView[] = ['today', 'week', 'month'];
const SWIPE_THRESHOLD = 50;

function isScheduleView(value: string | undefined): value is ScheduleView {
  return value !== undefined && SCHEDULE_VIEWS.includes(value as ScheduleView);
}

export default function SchedulePage() {
  const { view } = useParams<{ view?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  if (!isScheduleView(view)) {
    return <Navigate to="/schedule/today" replace />;
  }

  const navigateToView = (nextView: ScheduleView) => navigate(`/schedule/${nextView}`);
  const activeIndex = SCHEDULE_VIEWS.indexOf(view);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    // Schedule owns horizontal gestures so the app-level tab swipe does not
    // jump away while moving between today, week, and month.
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, button, [role="button"], [contenteditable="true"]')) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    touchStartX.current = event.touches[0].clientX;
    touchStartY.current = event.touches[0].clientY;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (touchStartX.current == null || touchStartY.current == null) return;

    const dx = event.changedTouches[0].clientX - touchStartX.current;
    const dy = event.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.2) return;

    if (dx < 0 && activeIndex < SCHEDULE_VIEWS.length - 1) {
      navigateToView(SCHEDULE_VIEWS[activeIndex + 1]);
    } else if (dx > 0 && activeIndex > 0) {
      navigateToView(SCHEDULE_VIEWS[activeIndex - 1]);
    }
  };

  return (
    <div className="cc-schedule" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="cc-schedule__switcher">
        <SegmentedControl
          ariaLabel={t('schedule.navigation')}
          options={SCHEDULE_VIEWS.map((scheduleView) => ({
            value: scheduleView,
            label: t(`schedule.${scheduleView}`),
          }))}
          value={view}
          onChange={(value) => navigateToView(value as ScheduleView)}
        />
      </div>
      {view === 'today' ? (
        <TodayContainer />
      ) : (
        <CalendarContainer key={view} initialView={view} showViewToggle={false} />
      )}
    </div>
  );
}
