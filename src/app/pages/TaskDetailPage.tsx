import { useParams } from 'react-router-dom';
import TaskDetail from '../components/task-detail/TaskDetail';

/** The task on its own page: deep links, and every phone-sized screen. */
export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  return <TaskDetail taskId={taskId ?? ''} />;
}
