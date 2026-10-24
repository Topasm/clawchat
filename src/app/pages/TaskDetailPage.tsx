import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import TaskDetail from '../components/task-detail/TaskDetail';
import { goBack } from '../services/returnTo';

/** The task on its own page: deep links, and every phone-sized screen. */
export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // ← returns to the list, project or chat this page was opened from; a
  // deep link that opened cold goes to the task list.
  const back = useCallback(
    () => goBack(navigate, location.state, '/tasks'),
    [navigate, location.state],
  );
  return <TaskDetail taskId={taskId ?? ''} onBack={back} />;
}
