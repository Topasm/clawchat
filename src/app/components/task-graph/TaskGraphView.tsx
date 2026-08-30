import { useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Edge,
  type NodeMouseHandler,
  type OnNodeDrag,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TaskFlowNode } from './taskGraphTypes';
import TaskGraphNode from './TaskGraphNode';
import { GraphIcon } from '../shared/Icons';
import { loadTaskGraphLayout, updateTaskGraphLayout } from './taskGraphPersistence';
import { translateUi } from '../../i18n';
interface TaskGraphViewProps {
  nodes: TaskFlowNode[];
  edges: Edge[];
  isMobile: boolean;
  selectedTaskId?: string | null;
  onSelectTask: (taskId: string | null) => void;
  persistenceScope?: string;
}
const nodeTypes = { task: TaskGraphNode };
function TaskGraphCanvas({
  nodes: sourceNodes,
  edges,
  isMobile,
  selectedTaskId,
  onSelectTask,
  persistenceScope,
}: TaskGraphViewProps) {
  const savedLayout = useMemo(
    () => (persistenceScope ? loadTaskGraphLayout(persistenceScope) : undefined),
    [persistenceScope],
  );
  const initialNodes = useMemo(
    () =>
      sourceNodes.map((node) => ({
        ...node,
        position: savedLayout?.positions[node.id] ?? node.position,
      })),
    [savedLayout, sourceNodes],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>(initialNodes);
  useEffect(() => {
    setNodes((currentNodes) => {
      if (!persistenceScope) return sourceNodes;
      const currentPositions = new Map(currentNodes.map((node) => [node.id, node.position]));
      return sourceNodes.map((node) => ({
        ...node,
        position: currentPositions.get(node.id) ?? savedLayout?.positions[node.id] ?? node.position,
      }));
    });
  }, [persistenceScope, savedLayout, setNodes, sourceNodes]);
  const handleNodeClick: NodeMouseHandler<TaskFlowNode> = (_event, node) => {
    onSelectTask(node.id);
  };
  const handleNodeDragStop: OnNodeDrag<TaskFlowNode> = (_event, node) => {
    if (!persistenceScope) return;
    const positions = Object.fromEntries(
      nodes.map((current) => [
        current.id,
        current.id === node.id ? node.position : current.position,
      ]),
    );
    updateTaskGraphLayout(persistenceScope, { positions });
  };
  const handleMoveEnd = (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    if (persistenceScope) updateTaskGraphLayout(persistenceScope, { viewport });
  };
  const displayedNodes = useMemo(
    () => nodes.map((node) => ({ ...node, selected: node.id === selectedTaskId })),
    [nodes, selectedTaskId],
  );
  return (
    <ReactFlow<TaskFlowNode>
      nodes={displayedNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={handleNodeDragStop}
      onMoveEnd={handleMoveEnd}
      onNodeClick={handleNodeClick}
      onPaneClick={() => onSelectTask(null)}
      nodesDraggable={!isMobile}
      nodesConnectable={false}
      edgesReconnectable={false}
      elementsSelectable
      panOnDrag
      zoomOnPinch
      zoomOnScroll={!isMobile}
      zoomOnDoubleClick={false}
      minZoom={0.3}
      maxZoom={1.4}
      defaultViewport={savedLayout?.viewport}
      fitView={!savedLayout?.viewport}
      fitViewOptions={{ padding: isMobile ? 0.14 : 0.2, maxZoom: 1 }}
      proOptions={{ hideAttribution: false }}
      aria-label={translateUi('Task relationship graph')}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} position="bottom-right" />
      {!isMobile && (
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          nodeColor={(node) => {
            const taskNode = node as TaskFlowNode;
            const status = taskNode.data.status;
            const insight = taskNode.data.insight;
            if (insight?.is_blocked) return 'var(--cc-error)';
            if (insight?.is_ready) return 'var(--cc-success)';
            if (insight?.is_on_critical_path) return 'var(--cc-warning)';
            return status === 'completed'
              ? 'var(--cc-success)'
              : status === 'in_progress'
                ? 'var(--cc-warning)'
                : status === 'cancelled'
                  ? 'var(--cc-text-tertiary)'
                  : 'var(--cc-primary)';
          }}
        />
      )}
    </ReactFlow>
  );
}
export default function TaskGraphView(props: TaskGraphViewProps) {
  if (props.nodes.length === 0) {
    return (
      <div className="cc-task-flow__empty">
        <GraphIcon size={48} />
        <strong>{translateUi('No tasks to map')}</strong>
        <span>{translateUi('Create a task or clear the active filters to build your graph.')}</span>
      </div>
    );
  }
  return (
    <div className="cc-task-flow__canvas">
      <ReactFlowProvider>
        <TaskGraphCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
