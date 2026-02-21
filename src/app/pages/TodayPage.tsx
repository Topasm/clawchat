import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import useTodayData from '../hooks/useTodayData';
import { useModuleStore } from '../stores/useModuleStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { formatDate } from '../utils/formatters';
import SectionHeader from '../components/shared/SectionHeader';
import TaskCard from '../components/shared/TaskCard';
import EventCard from '../components/shared/EventCard';
import EmptyState from '../components/shared/EmptyState';
import QuickCaptureModal from '../components/shared/QuickCaptureModal';

function isTextInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

function getTodayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getYesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TodayPage() {
  const navigate = useNavigate();
  const { todayTasks, overdueTasks, todayEvents, inboxCount, greeting, todayDate, isLoading } = useTodayData();
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);
  const allTodos = useModuleStore((s) => s.todos);
  const streak = useSettingsStore((s) => s.streak);
  const setStreak = useSettingsStore((s) => s.setStreak);
  const [showCapture, setShowCapture] = useState(false);
  const [capturePlaceholder, setCapturePlaceholder] = useState('');

  useHotkeys('t', (e) => {
    if (isTextInput(e)) return;
    e.preventDefault();
    setCapturePlaceholder('New task: e.g. "Buy groceries tomorrow"');
    setShowCapture(true);
  }, { enableOnFormTags: false });

  useHotkeys('e', (e) => {
    if (isTextInput(e)) return;
    e.preventDefault();
    setCapturePlaceholder('New event: e.g. "Meeting at 3pm"');
    setShowCapture(true);
  }, { enableOnFormTags: false });

  useHotkeys('n', (e) => {
    if (isTextInput(e)) return;
    e.preventDefault();
    setCapturePlaceholder('New memo: e.g. "Remember to check logs"');
    setShowCapture(true);
  }, { enableOnFormTags: false });

  const totalTasks = todayTasks.length + overdueTasks.length;
  const hasAnything = totalTasks > 0 || todayEvents.length > 0;

  const progress = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const allTodayTasks = allTodos.filter((t) => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      return d >= todayStart && d < todayEnd;
    });

    const completed = allTodayTasks.filter((t) => t.status === 'completed').length;
    const total = allTodayTasks.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const allDone = total > 0 && completed === total;

    return { completed, total, percentage, allDone };
  }, [allTodos]);

  useEffect(() => {
    if (!progress.allDone) return;

    const today = getTodayISO();
    if (streak.lastCompletedDate === today) return;

    const yesterday = getYesterdayISO();
    const newStreak = streak.lastCompletedDate === yesterday
      ? streak.currentStreak + 1
      : 1;

    setStreak({ lastCompletedDate: today, currentStreak: newStreak });
  }, [progress.allDone, streak, setStreak]);

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">{greeting || 'Hello'}</div>
        <div className="cc-page-header__subtitle">
          {todayDate ? formatDate(todayDate) : ''}
          {totalTasks > 0 && ` \u00B7 ${totalTasks} task${totalTasks !== 1 ? 's' : ''} for today`}
        </div>
      </div>

      <QuickCaptureModal
        isOpen={showCapture}
        onClose={() => setShowCapture(false)}
        placeholder={capturePlaceholder}
      />

      {progress.total > 0 && (
        <div className="cc-today-progress">
          <div className="cc-today-progress__header">
            <span className="cc-today-progress__label">
              {progress.allDone
                ? '\u2705 All done!'
                : `Today\u2019s Progress: ${progress.completed}/${progress.total} tasks`}
            </span>
            {streak.currentStreak > 0 && (
              <span className="cc-today-progress__streak">
                {'\uD83D\uDD25'} {streak.currentStreak} day streak
              </span>
            )}
          </div>
          <div className="cc-today-progress__track">
            <div
              className={`cc-today-progress__bar${progress.allDone ? ' cc-today-progress__bar--complete' : ''}`}
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {progress.total === 0 && !isLoading && hasAnything && (
        <div className="cc-today-progress">
          <span className="cc-today-progress__label">No tasks for today</span>
        </div>
      )}

      {isLoading && !hasAnything && (
        <div className="cc-empty__message" style={{ padding: 40, textAlign: 'center' }}>Loading...</div>
      )}

      {!isLoading && !hasAnything && (
        <EmptyState icon="\u2728" message="All clear! Nothing scheduled for today." />
      )}

      {todayEvents.length > 0 && (
        <SectionHeader title="Events" count={todayEvents.length} variant="accent">
          {todayEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onClick={() => navigate(`/events/${event.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {overdueTasks.length > 0 && (
        <SectionHeader title="Overdue" count={overdueTasks.length} variant="warning">
          {overdueTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {todayTasks.length > 0 && (
        <SectionHeader title="Today's Tasks" count={todayTasks.length}>
          {todayTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {inboxCount > 0 && (
        <div className="cc-inbox-banner" onClick={() => navigate('/inbox')}>
          <span style={{ fontSize: 16 }}>{'\uD83D\uDCE5'}</span>
          <span className="cc-inbox-banner__text">
            {inboxCount} item{inboxCount !== 1 ? 's' : ''} in your inbox
          </span>
        </div>
      )}
    </div>
  );
}
