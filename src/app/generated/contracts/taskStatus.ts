// Generated from server/openapi.json by scripts/generate-api-contracts.js. Do not edit.

export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
