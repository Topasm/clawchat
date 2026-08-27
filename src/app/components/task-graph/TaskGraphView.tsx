import { useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TaskFlowNode } from './taskGraphTypes';
import TaskGraphNode from './TaskGraphNode';
import { GraphIcon } from '../shared/Icons';

interface TaskGraphViewProps {
  nodes: TaskFlowNode[];
  edges: Edge[];
  isMobile: boolean;
  selectedTaskId?: string | null;
  onSelectTask: (taskId: string | null) => void;
}

const nodeTypes = { task: TaskGraphNode };

function TaskGraphCanvas({
  nodes: sourceNodes,
  edges,
  isMobile,
  selectedTaskId,
  onSelectTask,
}: TaskGraphViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>(sourceNodes);
  const { fitView } = useReactFlow<TaskFlowNode>();
  const layoutKey = useMemo(
    () => sourceNodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).join('|'),
    [sourceNodes],
  );

  useEffect(() => {
    setNodes(sourceNodes);
  }, [setNodes, sourceNodes]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: isMobile ? 0.14 : 0.2, duration: 240, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, isMobile, layoutKey]);

  const handleNodeClick: NodeMouseHandler<TaskFlowNode> = (_event, node) => {
    onSelectTask(node.id);
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
      fitView
      fitViewOptions={{ padding: isMobile ? 0.14 : 0.2, maxZoom: 1 }}
      proOptions={{ hideAttribution: false }}
      aria-label="Task relationship graph"
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
        <strong>No tasks to map</strong>
        <span>Create a task or clear the active filters to build your graph.</span>
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
