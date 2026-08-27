import type { Node, NodeProps } from '@xyflow/react';
import type { TaskStatus, TodoResponse } from '../../types/api';

export type TaskGraphMode = 'structure' | 'execution';

export type TaskGraphNodeData = {
  todo: TodoResponse;
  status: TaskStatus;
  mode: TaskGraphMode;
  childCount: number;
  completedChildCount: number;
  dependencyCount: number;
  hasVisibleChildren: boolean;
  isCollapsed: boolean;
  proposalSelection?: 'selected' | 'excluded' | 'fixed';
  onToggleCollapse: (taskId: string) => void;
};

export type TaskFlowNode = Node<TaskGraphNodeData, 'task'>;
export type TaskFlowNodeProps = NodeProps<TaskFlowNode>;
