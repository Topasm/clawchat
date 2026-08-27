// Generated from server/openapi.json by scripts/generate-api-contracts.js. Do not edit.

export const TASK_RELATIONSHIP_TYPES = ['depends_on', 'related', 'duplicate'] as const;

export type TaskRelationshipType = (typeof TASK_RELATIONSHIP_TYPES)[number];
