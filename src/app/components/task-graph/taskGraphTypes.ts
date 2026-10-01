import type { Node, NodeProps } from '@xyflow/react';
import type { TaskGraphInsightNode, TaskStatus, TodoResponse } from '../../types/api';

export type TaskGraphMode = 'structure' | 'execution';

type TaskGraphNodeData = {
  todo: TodoResponse;
  status: TaskStatus;
  mode: TaskGraphMode;
  childCount: number;
  /** The task that stands for a project; the only card that earns the Project badge. */
  isProjectRoot: boolean;
  completedChildCount: number;
  dependencyCount: number;
  hasVisibleChildren: boolean;
  isCollapsed: boolean;
  insight?: TaskGraphInsightNode;
  proposalSelection?: 'selected' | 'excluded' | 'fixed';
  onToggleCollapse: (taskId: string) => void;
};

export type TaskFlowNode = Node<TaskGraphNodeData, 'task'>;
export type TaskFlowNodeProps = NodeProps<TaskFlowNode>;
