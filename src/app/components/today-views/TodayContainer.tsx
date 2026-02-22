import useTodayData from '../../hooks/queries/useTodayQuery';
import useTodayProgress from '../../hooks/useTodayProgress';
import useTodayBriefing from '../../hooks/useTodayBriefing';
import useTodayHotkeys from '../../hooks/useTodayHotkeys';
import TodayView from './TodayView';

export default function TodayContainer() {
  const { todayTasks, overdueTasks, todayEvents, inboxCount, greeting, todayDate, isLoading } = useTodayData();
  const { progress, streak } = useTodayProgress();
  const { briefing, briefingLoading } = useTodayBriefing();
  const { showCapture, setShowCapture, capturePlaceholder } = useTodayHotkeys();

  return (
    <TodayView
      greeting={greeting}
      todayDate={todayDate}
      todayTasks={todayTasks}
      overdueTasks={overdueTasks}
      todayEvents={todayEvents}
      inboxCount={inboxCount}
      isLoading={isLoading}
      progress={progress}
      streakCount={streak.currentStreak}
      briefing={briefing}
      briefingLoading={briefingLoading}
      showCapture={showCapture}
      onCloseCapture={() => setShowCapture(false)}
      capturePlaceholder={capturePlaceholder}
    />
  );
}
