import type { Viewport, XYPosition } from '@xyflow/react';
import type { TaskGraphMode } from './taskGraphTypes';

const STORAGE_KEY = 'clawchat-task-graph-layouts-v1';

export interface TaskGraphLayoutSnapshot {
  positions: Record<string, XYPosition>;
  viewport?: Viewport;
  collapsedIds: string[];
}

type StoredLayouts = Record<string, TaskGraphLayoutSnapshot>;

const emptySnapshot = (): TaskGraphLayoutSnapshot => ({
  positions: {},
  collapsedIds: [],
});

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePosition(value: unknown): XYPosition | null {
  if (!value || typeof value !== 'object') return null;
  const position = value as Record<string, unknown>;
  if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y)) return null;
  return { x: position.x, y: position.y };
}

function parseViewport(value: unknown): Viewport | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const viewport = value as Record<string, unknown>;
  if (
    !isFiniteNumber(viewport.x) ||
    !isFiniteNumber(viewport.y) ||
    !isFiniteNumber(viewport.zoom) ||
    viewport.zoom <= 0
  ) {
    return undefined;
  }
  return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
}

function parseSnapshot(value: unknown): TaskGraphLayoutSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Record<string, unknown>;
  const positions: Record<string, XYPosition> = {};
  if (snapshot.positions && typeof snapshot.positions === 'object') {
    Object.entries(snapshot.positions).forEach(([id, position]) => {
      const parsed = parsePosition(position);
      if (parsed) positions[id] = parsed;
    });
  }

  return {
    positions,
    viewport: parseViewport(snapshot.viewport),
    collapsedIds: Array.isArray(snapshot.collapsedIds)
      ? [...new Set(snapshot.collapsedIds.filter((id): id is string => typeof id === 'string'))]
      : [],
  };
}

function readLayouts(): StoredLayouts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return {};

    const layouts: StoredLayouts = {};
    Object.entries(value).forEach(([scope, snapshot]) => {
      const parsed = parseSnapshot(snapshot);
      if (parsed) layouts[scope] = parsed;
    });
    return layouts;
  } catch {
    return {};
  }
}

function writeLayouts(layouts: StoredLayouts): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Graph persistence is an optional enhancement when storage is unavailable.
  }
}

export function createTaskGraphLayoutScope(projectId: string, mode: TaskGraphMode): string {
  return `${mode}:${encodeURIComponent(projectId)}`;
}

export function loadTaskGraphLayout(scope: string): TaskGraphLayoutSnapshot {
  return readLayouts()[scope] ?? emptySnapshot();
}

export function updateTaskGraphLayout(
  scope: string,
  patch: Partial<TaskGraphLayoutSnapshot>,
): void {
  const layouts = readLayouts();
  const current = layouts[scope] ?? emptySnapshot();
  layouts[scope] = {
    positions: patch.positions ?? current.positions,
    viewport: patch.viewport ?? current.viewport,
    collapsedIds: patch.collapsedIds ?? current.collapsedIds,
  };
  writeLayouts(layouts);
}

export function resetTaskGraphLayout(scope: string): void {
  const layouts = readLayouts();
  if (!(scope in layouts)) return;
  delete layouts[scope];
  writeLayouts(layouts);
}
