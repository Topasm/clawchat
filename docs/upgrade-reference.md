# Upgrade Reference

Implementation guidance and historical design notes for upgrades. Some sections are already implemented; verify the roadmap and current source before treating a snippet as current architecture.

> Source: patterns and libraries originally identified while analyzing the vibe-kanban codebase.

---

## 1. TanStack Query (React Query)

**Status**: Implemented for server state and mutations.

**Why**: Replace manual Axios + Zustand API fetching with automatic caching, background refetch, loading/error states, and retry logic. Eliminates boilerplate in stores.

**Install**:
```bash
npm install @tanstack/react-query
npm install -D @tanstack/react-query-devtools  # optional, for debugging
```

**Setup** — wrap app in `QueryClientProvider` (`App.tsx`):
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30s before data is considered stale
      retry: 1,                // retry failed requests once
      refetchOnWindowFocus: true,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

**Migration pattern** — replace `useModuleStore.fetchTodos()` with a query hook:
```tsx
// hooks/useTodos.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';

export function useTodos() {
  return useQuery({
    queryKey: ['todos'],
    queryFn: () => apiClient.get('/api/todos').then(r => r.data),
    enabled: !!useAuthStore.getState().serverUrl,  // skip in demo mode
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TodoCreate) => apiClient.post('/api/todos', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}
```

**What stays in Zustand**: kanban filters, panel sizes, theme, UI preferences — anything not from the server.

---

## 2. Zod Runtime Validation

**Status**: Implemented. Canonical task-status values are generated from OpenAPI and consumed by the Zod schema.

**Why**: Catch API contract mismatches at runtime instead of silently passing bad data into components. Also replaces manual form validation.

**Install**:
```bash
npm install zod
```

**API response schemas** — mirror existing TypeScript types:
```tsx
// types/schemas.ts
import { z } from 'zod';

export const TodoResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable(),
  due_date: z.string().nullable(),
  tags: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});

export const TodoCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type TodoResponse = z.infer<typeof TodoResponseSchema>;
export type TodoCreate = z.infer<typeof TodoCreateSchema>;
```

**Validate in query hooks**:
```tsx
export function useTodos() {
  return useQuery({
    queryKey: ['todos'],
    queryFn: async () => {
      const { data } = await apiClient.get('/api/todos');
      return z.array(TodoResponseSchema).parse(data);  // throws if invalid
    },
  });
}
```

**Form validation**:
```tsx
const result = TodoCreateSchema.safeParse(formData);
if (!result.success) {
  // result.error.issues contains field-level error messages
}
```

---

## 3. Error Boundaries

**Status**: Implemented at the application, layout, and route levels.

**Why**: Prevent a crash in one component from white-screening the entire app.

**Option A — Lightweight (no external dep)**:
```tsx
// components/shared/ErrorBoundary.tsx
import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="cc-error-fallback">
          <h2>Something went wrong</h2>
          <button onClick={() => this.setState({ hasError: false })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**Option B — With Sentry**:
```bash
npm install @sentry/react
```
```tsx
import * as Sentry from '@sentry/react';

// In App.tsx
<Sentry.ErrorBoundary fallback={<ErrorFallbackPage />}>
  <RouterProvider router={router} />
</Sentry.ErrorBoundary>
```

**Placement**: Wrap `<Layout>` in a top-level boundary, and optionally wrap individual pages for isolation.

---

## 4. Sub-tasks

**Status**: Implemented with `todos.parent_id` and client-side grouping.

**Database change** (server):
```sql
ALTER TABLE todos ADD COLUMN parent_id TEXT REFERENCES todos(id) ON DELETE SET NULL;
CREATE INDEX idx_todos_parent ON todos(parent_id);
```

**Type change** (client):
```tsx
interface TodoResponse {
  // ... existing fields
  parent_id: string | null;
  sub_tasks?: TodoResponse[];  // populated by server or client-side grouping
}
```

**UI pattern**: In kanban cards and task lists, group by `parent_id`. Render sub-tasks as indented items with a collapse toggle.

---

## 5. Task Relationships

**Status**: Implemented. `task_relationships` is the server-owned source of truth,
and Graph/task-detail clients use its API. The nullable `todos.depends_on` field
remains only as a transactionally synchronized compatibility shadow for older
clients and safe migration rollback.

The migration preserves valid existing edges and fails closed on malformed
JSON, self-edges, duplicates, dangling todo IDs, cycles, or a lossy downgrade.
Runtime validation and SQLite triggers enforce the same graph invariants.
`blocked` will be computed from incomplete prerequisites; it must not be added
to the canonical task lifecycle enum described in [ADR 003](./adr/003-task-status-source-of-truth.md).

**Database shape** (server):
```sql
CREATE TABLE task_relationships (
  id TEXT PRIMARY KEY,
  source_task_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  target_task_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('depends_on', 'related', 'duplicate')),
  label TEXT,
  created_by TEXT NOT NULL DEFAULT 'user',
  proposal_id TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(source_task_id, target_task_id, type)
);
```

For `depends_on`, `source_task_id` is the task being executed and `target_task_id` is its prerequisite. The inverse `blocks` direction is derived at query time rather than stored as a second edge.

**UI**: Task detail dependency edits use relationship POST/DELETE mutations. The
execution Graph, filtered prerequisite closure, proposal preview, graph-node
counts, and TaskCard counts read normalized edges. Dependency count indexing is
shared per query result so rendering many cards is O(edges + cards), not
O(edges × cards).

---

## 6. Bulk Operations

**Status**: Implemented.

**API endpoint** (server):
```
PATCH /api/todos/bulk
Body: { ids: string[], status?, priority?, tags?, delete?: boolean }
Response: { updated: number, deleted: number, errors: string[] }
```

**UI pattern**:
- Add a checkbox to each `KanbanCard` (visible in multi-select mode)
- Floating toolbar appears when 1+ cards selected: "Change Status | Change Priority | Add Tag | Delete"
- Reference: vibe-kanban's `bulkUpdateIssues()` in `lib/api.ts`

---

## 7. Rich Text — Lexical Editor Component

**Status**: The reusable component and tests are implemented, but it is not currently mounted in a persisted task, memo, or document workflow.

**Installed**:
```bash
npm install lexical @lexical/react @lexical/markdown @lexical/rich-text @lexical/list @lexical/link @lexical/code @lexical/utils
```

**Implementation**: `src/app/components/shared/RichTextEditor.tsx` — a reusable component with:
- `ToolbarPlugin` — Bold, Italic, Bullet List, Numbered List with active state tracking
- `MarkdownShortcutPlugin` — Auto-format on typing (e.g., `**bold**`, `# heading`)
- `SetInitialContentPlugin` — Loads markdown via `$convertFromMarkdownString` on mount
- `SaveShortcutPlugin` — Ctrl+Enter triggers save callback
- `OnChangePlugin` — Fires `onChange` with markdown via `$convertToMarkdownString`

Props: `initialMarkdown`, `onChange`, `placeholder`, `editable`, `onSave`

Theme classes: `.cc-rte__paragraph`, `.cc-rte__h1-h3`, `.cc-rte__bold/italic`, `.cc-rte__ul/ol/li`, `.cc-rte__link`, `.cc-rte__inline-code`, `.cc-rte__code-block`, `.cc-rte__blockquote`

Read-only mode: `editable={false}` hides toolbar and removes borders for inline display.

**Target storage**: Persist Markdown in the owning task/document workflow. Lexical already converts Markdown on load and back on change; the product integration remains planned.

---

## 8. CodeMirror for System Prompt *(Completed — Phase 4)*

**Installed**:
```bash
npm install @uiw/react-codemirror @codemirror/lang-markdown @codemirror/theme-one-dark
```

**Implementation**: `src/app/components/shared/CodeEditor.tsx` — a reusable wrapper with:
- Props: `value`, `onChange`, `language` (markdown/json), `maxLength`, `height`, `placeholder`
- Dark mode: Reads `theme` from `useSettingsStore`, applies `oneDark` in dark mode
- Features: line numbers, active line highlight, bracket matching, word wrap

Integrated into `SystemPromptPage.tsx`, replacing the plain textarea. Character counter, Reset, and Save buttons unchanged.

---

## 9. Virtual Scrolling

**Status**: Planned; no virtualization library is currently installed.

**Install**:
```bash
npm install react-virtuoso
```

**Use for chat messages** (currently renders all messages in a div):
```tsx
import { Virtuoso } from 'react-virtuoso';

<Virtuoso
  data={messages}
  itemContent={(index, message) => <MessageBubble key={message.id} message={message} />}
  followOutput="smooth"    // auto-scroll to new messages
  initialTopMostItemIndex={messages.length - 1}
/>
```

**Use for task lists** in Inbox page and search results when list exceeds ~50 items.

---

## 10. Framer Motion Animations

**Status**: Implemented for route/panel transitions, dialogs, toasts, and bulk controls.

**Install**:
```bash
npm install framer-motion
```

**Page transitions**:
```tsx
import { motion } from 'framer-motion';

function PageWrapper({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {children}
    </motion.div>
  );
}
```

**Toast animations** (replace current CSS animations):
```tsx
<motion.div
  initial={{ x: 100, opacity: 0 }}
  animate={{ x: 0, opacity: 1 }}
  exit={{ x: 100, opacity: 0 }}
/>
```

---

## 11. Internationalization (i18next)

**Install**:
```bash
npm install i18next react-i18next
```

**Setup**:
```tsx
// i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
```

**Usage in components**:
```tsx
import { useTranslation } from 'react-i18next';

function TodayPage() {
  const { t } = useTranslation();
  return <h1>{t('today.greeting', { name: 'User' })}</h1>;
}
```

**Locale file** (`i18n/locales/en.json`):
```json
{
  "today": { "greeting": "Good morning, {{name}}" },
  "kanban": { "todo": "Todo", "in_progress": "In Progress", "done": "Done" },
  "actions": { "delete": "Delete", "edit": "Edit", "save": "Save", "cancel": "Cancel" }
}
```

---

## Library Summary

| Library | Version | Purpose | Phase |
|---------|---------|---------|-------|
| `@tanstack/react-query` | ^5 | Server state + caching | 2 |
| `zod` | ^3 | Runtime validation | 2 |
| `@sentry/react` | ^9 | Error boundaries + tracking | 2 |
| `vitest` + `@testing-library/react` | latest | Unit + component tests | 2 |
| `lexical` + `@lexical/react` | ^0.36 | Rich text editor | 4 (done) |
| `@uiw/react-codemirror` | ^4 | Code/prompt editor | 4 (done) |
| `react-virtuoso` | ^4 | Virtual scrolling | 7 |
| `framer-motion` | ^11 | Animations | 7 |
| `i18next` + `react-i18next` | ^25 / ^15 | Internationalization | Future |
