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
  onOpenTask: (taskId: string) => void;
}

const nodeTypes = { task: TaskGraphNode };

function TaskGraphCanvas({ nodes: sourceNodes, edges, isMobile, onOpenTask }: TaskGraphViewProps) {
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
    onOpenTask(node.id);
  };

  return (
    <ReactFlow<TaskFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
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
            const status = (node as TaskFlowNode).data.status;
            return status === 'completed'
              ? 'var(--cc-success)'
              : status === 'in_progress'
                ? 'var(--cc-warning)'
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
