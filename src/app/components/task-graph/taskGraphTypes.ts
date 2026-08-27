import type { Node, NodeProps } from '@xyflow/react';
import type { KanbanStatus, TodoResponse } from '../../types/api';

export type TaskGraphMode = 'structure' | 'execution';

export type TaskGraphNodeData = {
  todo: TodoResponse;
  status: KanbanStatus;
  mode: TaskGraphMode;
  childCount: number;
  completedChildCount: number;
  hasVisibleChildren: boolean;
  isCollapsed: boolean;
  proposalSelection?: 'selected' | 'excluded' | 'fixed';
  onToggleCollapse: (taskId: string) => void;
};

export type TaskFlowNode = Node<TaskGraphNodeData, 'task'>;
export type TaskFlowNodeProps = NodeProps<TaskFlowNode>;
