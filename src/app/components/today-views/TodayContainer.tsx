import { useMemo } from 'react';
import useTodayData from '../../hooks/queries/useTodayQuery';
import useTodayProgress from '../../hooks/useTodayProgress';
import useTodayBriefing from '../../hooks/useTodayBriefing';
import useTodayHotkeys from '../../hooks/useTodayHotkeys';
import { useTodosQuery } from '../../hooks/queries';
import TodayView from './TodayView';

const NEEDS_REVIEW_LIMIT = 5;

export default function TodayContainer() {
  const { todayTasks, overdueTasks, todayEvents, inboxCount, greeting, todayDate, isLoading } = useTodayData();
  const { progress, streak } = useTodayProgress();
  const { briefingData, briefingLoading } = useTodayBriefing();
  useTodayHotkeys();

  const { data: allTodos = [] } = useTodosQuery();

  const needsReviewItems = useMemo(() => {
    return allTodos
      .filter((t) => t.inbox_state === 'plan_ready' || t.inbox_state === 'captured')
      .slice(0, NEEDS_REVIEW_LIMIT);
  }, [allTodos]);

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
      briefingData={briefingData}
      briefingLoading={briefingLoading}
      needsReviewItems={needsReviewItems}
    />
  );
}
