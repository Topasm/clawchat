# Upgrade Reference

Concrete implementation guidance for planned upgrades. Each section includes the library, install command, and integration pattern for ClawChat.

> Source: patterns and libraries identified from analyzing the [vibe-kanban](../../vibe-kanban) codebase.

---

## 1. TanStack Query (React Query)

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

**Database change** (server):
```sql
ALTER TABLE todos ADD COLUMN parent_id TEXT REFERENCES todos(id) ON DELETE CASCADE;
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

**Database** (server):
```sql
CREATE TABLE task_relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('blocks', 'blocked_by', 'related', 'duplicate_of')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, target_id, type)
);
```

**UI**: Task detail page gets a "Related Tasks" section where users can search and link other tasks. Kanban cards show a small icon when the task has blockers.

---

## 6. Bulk Operations

**API endpoint** (server):
```
PATCH /api/todos/bulk
Body: { ids: string[], update: { status?, priority?, tags_add?, tags_remove? } }
```

**UI pattern**:
- Add a checkbox to each `KanbanCard` (visible in multi-select mode)
- Floating toolbar appears when 1+ cards selected: "Change Status | Change Priority | Add Tag | Delete"
- Reference: vibe-kanban's `bulkUpdateIssues()` in `lib/api.ts`

---

## 7. Rich Text — Lexical Editor *(Completed — Phase 4)*

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

**Storage**: Memo content stored as markdown on server. Lexical converts markdown on load and converts back on save.

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
