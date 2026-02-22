import { useEffect, useMemo } from 'react';
import { useModuleStore } from '../stores/useModuleStore';
import { useSettingsStore } from '../stores/useSettingsStore';

function getTodayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getYesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function useTodayProgress() {
  const allTodos = useModuleStore((s) => s.todos);
  const streak = useSettingsStore((s) => s.streak);
  const setStreak = useSettingsStore((s) => s.setStreak);

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

  return { progress, streak };
}
