/**
 * Orval configuration for OpenAPI-driven code generation.
 *
 * Generates React Query (TanStack Query v5) hooks and TypeScript types
 * from the FastAPI backend's OpenAPI spec.
 *
 * Usage:
 *   npm run generate:api
 *
 * The FastAPI OpenAPI snapshot is generated first by `npm run generate:api`, so
 * code generation is deterministic and does not require a running server.
 *
 * The generated code lives in src/app/generated/ and uses the existing
 * apiClient axios instance (via customFetcher) to preserve JWT auth,
 * token refresh, base URL handling, and offline queue support.
 *
 * NOTE: SSE streaming (chat) and WebSocket connections are NOT covered
 * by code generation — those remain hand-written.
 */
import { defineConfig } from 'orval';

export default defineConfig({
  clawchat: {
    input: {
      target: 'server/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: 'src/app/generated/',
      schemas: 'src/app/generated/schemas',
      client: 'react-query',
      httpClient: 'axios',
      formatter: 'prettier',
      override: {
        mutator: {
          path: './src/app/services/customFetcher.ts',
          name: 'customFetcher',
        },
      },
    },
  },
});
