import useTodayData from '../../hooks/queries/useTodayQuery';
import useTodayBriefing from '../../hooks/useTodayBriefing';
import useTodayHotkeys from '../../hooks/useTodayHotkeys';
import TodayView from './TodayView';

export default function TodayContainer() {
  const { todayTasks, overdueTasks, todayEvents, todayDate, isLoading } = useTodayData();
  const { briefingData, briefingLoading } = useTodayBriefing();
  useTodayHotkeys();

  return (
    <TodayView
      todayDate={todayDate}
      todayTasks={todayTasks}
      overdueTasks={overdueTasks}
      todayEvents={todayEvents}
      isLoading={isLoading}
      briefingData={briefingData}
      briefingLoading={briefingLoading}
    />
  );
}
