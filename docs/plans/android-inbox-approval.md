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

## Stage 4: compact mobile approval UI

- Capture now stays in the bottom composer (one line initially, up to four while
  typing); the list reserves its height and the composer follows the keyboard.
  Successful capture hides the keyboard without discarding a failed draft.
- Server-mode approval count comes from the visible, non-deferred preview-page
  tasks, not the legacy Inbox summary. Legacy plan/review/error sections remain
  available below the approval list; navigation tabs are unchanged.
- Cards show title, destination and a localized date. Past-date warnings remain
  visible; recommendation reason and deadline inclusion move into one edit sheet.
- The edit sheet chooses an existing project and parent task by root-task traversal,
  excluding the current task and its descendants. Location and deadline inclusion
  are persisted in one review request, without applying a task mutation. Cancel
  discards the draft; success closes the sheet only after server acknowledgement.
  A changed graph revision disables saving until the editor is reopened.
- Arbitrary date editing and the navigation-drawer redesign are not part of this
  step. Physical-device checks still need small screens, large fonts, keyboard,
  sheet scrolling, back navigation and offline-save coverage.

## Stage 5: open the approved work in context

- Inbox task actions now have real navigation callbacks. Approved standalone work
  opens task detail; project work opens its project with the approved task selected,
  its ancestors expanded, and the outline scrolled to the task.
- A project opened from Inbox returns directly to Inbox. Opening its conversation
  leaves the plan on the back stack, preserving selection, collapsed branches and
  scroll position. Project conversations show a Plan return action; task/run
  threads do not masquerade as the project conversation.
- Project and explicitly opened conversation screens hide global bottom navigation
  to leave space for the selected-task actions or composer. Primary destinations
  keep their existing navigation.
- Uses existing project and conversation APIs. No new chat execution system or
  global drawer change. Physical-device navigation/scroll checks are still pending.

## Stage 6: drawer navigation and conversation drafts

- Primary navigation now uses a modal left drawer instead of a persistent bottom
  bar. Existing top app bars provide its menu button; detail screens keep Back.
  Inbox and Projects are directly discoverable. Search/Settings form a separated
  utility group. Local mode only exposes supported destinations.
- Opening is button-driven so Android edge-back and the schedule pager keep their
  gestures. The open drawer supports swipe-to-close, scrim dismissal and Back.
- Unsent conversation drafts live in an app-process singleton keyed by workspace
  identity and conversation ID. Returning to Plan and reopening the thread preserves
  the draft; another workspace/run never shares it. No network writes are involved.
  This is intentionally not disk persistence: force-stop/process death clears drafts.
- Physical-device checks remain necessary for menu reachability, Back ordering,
  large fonts, keyboard sizing, plan/chat round trips and workspace switching.

## Stage 7: durable drafts

- Drafts now persist in the existing app-private DataStore, which is excluded from
  cloud backup and device transfer. Keys hash workspace identity and conversation ID;
  text stays local and is not sent until the user sends a message.
- Restoration must finish before editing is accepted. A process-level serialized
  writer continues when a chat screen closes and coalesces pending snapshots. Failed
  saves retain the in-memory draft and expose Retry; failed restoration cannot
  overwrite stored drafts with an empty map. Unrelated session/settings keys are
  preserved.
- The composer shows restoring/saving/failure states. Only completed disk writes
  survive abrupt termination; killing the process while Saving is visible may lose
  the latest edit. File reopen, retry, latest-edit and workspace-isolation tests cover
  this storage behavior. Real-device force-stop/keyboard checks remain outstanding.

## Stage 8: mobile sizing consistency

- Inbox and chat share one bottom composer: 16 dp horizontal inset, up to four
  lines, body-large text, theme-owned input shape, and a 48 dp action target with
  a 24 dp icon. Supporting save/error messages use the same aligned area.
- Voice input moves to the chat app bar's More menu. Send/Stop remain in the input
  field; there are no separate always-visible voice/send boxes consuming text width.
- Project/chat titles use title-large, project Back uses the standard arrow, and
  task titles use title-medium with two-line list truncation. Selected task/detail
  and placement editor still show complete titles.
- Placement options are full-width radio rows with minimum 48 dp height and wrapping
  labels. Footer actions wrap at large font sizes. Outline indentation caps at three
  visual levels without changing the actual task hierarchy.
- Automated checks do not replace screenshots on a 320/360 dp device with default
  and enlarged fonts, keyboard open/closed, and long Korean titles.

## Final navigation hardening

- Project selection is saved with the navigation entry's SavedStateHandle. On
  recreation the current project title and root graph are fetched again; Back to
  the project list clears the selection. No project content is frozen in saved state.
- Selected tasks display their ancestor path so capped indentation does not hide
  branch context. Path traversal terminates safely on malformed cycles.
- Inbox-to-outline focus index accounts for ready summaries, errors, loading and
  hidden completed work. Missing tasks are not silently scrolled to the first node.
- Automated restoration/path/focus checks supplement, but do not replace, physical
  device process recreation, enlarged-font, keyboard and back-stack tests.

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
