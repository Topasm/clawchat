/**
 * Orval configuration for OpenAPI-driven code generation.
 *
 * Generates React Query (TanStack Query v5) hooks and TypeScript types
 * from the FastAPI backend's OpenAPI spec.
 *
 * Usage:
 *   npm run generate:api
 *
 * Prerequisites:
 *   - The backend server must be running at http://localhost:8000
 *     (start with: make dev-backend)
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
      target: 'http://localhost:8000/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: 'src/app/generated/',
      schemas: 'src/app/generated/schemas',
      client: 'react-query',
      override: {
        mutator: {
          path: './src/app/services/customFetcher.ts',
          name: 'customFetcher',
        },
        query: {
          useQuery: true,
          useMutation: true,
        },
      },
    },
  },
});
