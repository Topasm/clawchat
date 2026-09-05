# Android Inbox approval workflow

## Stage 1: existing-project placement

- The Inbox input stores the trimmed original text as a `captured` task through
  TodoRepository. An operation ID is reused when retrying the same failed capture.
  Server-mode offline captures use the existing durable pending-create queue.
- While the Android Inbox is open, the client reads pending captures (50 per page)
  and requests the existing revision-bound triage preview. Capture sync notifications
  refresh this view. Local-only workspaces store captures but do not call AI.
- The preview shows the existing project/parent and reason. Approve uses the
  single-task placement API with the exact preview revision and `inbox_state=none`.
  The existing task is moved; no second task or agent run is created.
- Unknown destinations and proposed new parent groups require manual selection.
  This stage supports choosing an existing project root or a standalone task.
- A successful placement exposes Open task and Undo using the returned change-set ID.
  Other suggestions are regenerated after mutation, not silently rebased.
- Requests are pinned to the originating server scope. A workspace switch discards
  pending UI results. Duplicate approval is blocked; mutation errors require a fresh
  preview. AI-unavailable errors still allow explicit manual placement when a valid
  graph snapshot was loaded.
- The legacy plan-ready Review button opens the task instead of rerunning organization.

## Stage 2: deadline and follow-up context

- Preview accepts the Android device's IANA timezone. A small deterministic parser
  recognizes Korean weekday + `까지`/`마감`, `오늘`/`내일`/`모레`, English
  `by [this/next] Friday`-style weekdays, and ISO date deadlines. Bare weekdays mean
  the capture's Monday–Sunday week; past deadlines are shown with a warning, not
  rolled to next week. Multiple or unsupported date expressions are not guessed.
- Captured tasks preserve the original submitted timestamp through retries and the
  offline create queue (`captured_at` input, stored as `created_at` in UTC). Older
  clients fall back to server creation time. The preview timezone is shown on the
  card; switching device timezone can change a newly generated preview.
- Only tasks without an existing deadline receive a deadline proposal. Android
  shows the actual local date and source phrase, with a checkbox to omit the date.
  Approval writes placement and deadline in the same revision-bound transaction.
  Undo restores both, retaining compatibility with old placement change sets.
- Date-only deadlines use local wall time `YYYY-MM-DDT23:59:59`, matching existing
  calendar task creation. They are not UTC instants (SQLite DateTime would lose the
  offset and shift the visible calendar date in some zones). The preview timezone
  is used to resolve the capture's week and calculate past-deadline warnings.
  They are task due dates, not calendar events or work-duration time blocks.
- AI context includes up to 20 recent applied placement records whose current task
  location still matches the approved one. Related follow-ups are guided toward the
  same project/workstream as siblings; unrelated or ambiguous inputs should remain
  unassigned. No dependency is inferred and no agent execution is started.
- Context and validation have deterministic tests with a fake AI. Actual model
  classification quality and Android device interaction still require live checks.

## Stage 3: durable review state

- The server stores up to eight preview batches per authenticated subject at the
  current graph revision. Keys include requested tasks, timezone and prompt-relevant
  task/project content. A matching preview can be read even when AI is unavailable;
  the past-deadline warning is recalculated when read. This is a stored result cache,
  not an in-memory cache or a new execution queue.
- Deferred flags, deadline exclusion and explicit manual destinations are saved per
  subject/task. Android loads them before requesting a preview. A manual destination
  is restored only at its saved graph revision; stale choices are never rebased.
- UI preference edits wait for server acknowledgement. Errors remain visible and
  require refresh before approval. Completed/moved captures are excluded from state
  reads, and preferences do not mutate the task graph or its revision.
- Migration `b2d4f6a8c013` adds two small tables and supports legacy create-all
  databases. Deploy the server migration with the Android update; older servers lack
  the review-state endpoints, so the client will show an error instead of pretending
  that a preference was saved.

## Remaining stages

### Integration checks

- HTTP workflow regression covers capture/retry, preview without mutation, defer,
  restored review state, cached preview, approval, immediate Undo, reapproval,
  follow-up context and rejection of an Undo after intervening graph edits.
- The workflow runs in both Asia/Seoul and America/Los_Angeles. Calendar regression
  verifies that the approved local deadline stays on the same Friday in both zones.
- A project goal change during AI generation invalidates the result before caching,
  even if that change does not increment graph revision.
- No Android device/emulator was connected during these checks. Still perform:
  1. Enter a paper deadline in the app and inspect project, branch and actual date.
  2. Defer it, force-stop/reopen the app, then resume review.
  3. Exclude/include the date, approve once, and verify the project tree and calendar.
  4. Undo immediately, then approve again and capture a related figure task.
  5. Verify real AI placement quality, network loss and keyboard/small-screen behavior.

### Optional follow-ups

1. Background generation jobs, only if needed: unfinished AI generation is not
   resumed after a server restart. Reopening retries missing results. The last Undo
   button and unsent input remain ViewModel-only, although applied change sets are
   durable on the server.
2. Actual-device workflow checks and optional new-project/new-parent creation.
3. Broader date expressions and date editing inside the card, if real use warrants
   them. For now omit a proposed deadline and edit the task manually when necessary.

No release or background agent execution is implied by this stage.
