# Android navigation simplification

## Implemented first stage

- Server workspaces start at Inbox, including after onboarding. Local workspaces
  still start at Tasks because server Inbox placement is unavailable locally.
- Inbox owns new capture via its existing bottom composer. Removed the duplicate
  central Quick Capture / Start now card from the progress screen.
- The existing `progress` route remains compatible with notification links but
  is labeled Attention and opened as a secondary drawer destination. Inbox,
  Projects and Schedule appear first in the drawer.
- Attention shows requests first. Existing active-work controls are retained in
  an initially collapsed section until their comments/steps affordances can be
  migrated without feature loss. This is not yet a requests-only screen.
- Hide routine connection status when connected with no queued edits. Keep
  disconnection, pending synchronization and retry errors visible.
- The schedule's Open Inbox actions now actually open Inbox, not progress.

## Project conversation panel

- Project and selected-task discussions, including run threads with a conversation,
  open in a full-height bottom sheet over the existing project route. The plan
  stays composed, preserving its selection and list position when the sheet closes.
- Reuses ChatScreen and its one bottom composer, workspace/thread draft storage,
  review and permission actions. No new feature-to-feature dependency is needed:
  the app layer composes the existing project and chat features.
- Chat ViewModels are keyed per conversation within the project route. Reopening
  the same thread does not reset a live stream; process recreation rebinds a missing
  selection. Conversation loading does not flash the global chat list.
- Project conversation entry now stays at the bottom when no task is selected;
  selected tasks use the existing bottom action area instead of stacking another
  bar. The duplicate project conversation button in the body is removed.
- Explicit Project/Discuss entry requests input focus once drafts are ready.
  Opening an execution thread for status/review does not automatically open the
  keyboard. The actual composer is still inside the panel, not a fake editable
  field in the outline.

## Remaining follow-up

- Task notes have moved to a single bottom composer in server-backed task detail,
  labeled separately from agent chat. The old attention comment UI and its polling
  request are removed. Per-task drafts survive SavedStateHandle restoration;
  failed saves keep drafts, and duplicate clicks are blocked. Successful responses
  may represent the repository's existing durable offline queue, not server receipt.
- Step editing now lives in task detail: direct children have a compact list,
  Add step opens a bottom composer sheet, and each child opens the existing task
  detail actions (including experiment completion confirmation and delete undo).
  Back navigation returns to the parent. Child queries paginate independently of
  the main task list. Drafts are scoped per parent; retries reuse an operation key.
  Attention retains an active-work summary and completion/pause controls, but
  no longer contains the duplicate step editor. Legacy ViewModel step methods
  remain; this stage changes the screen workflow, not the server contract.
- Verify panel keyboard focus/insets on a device, including reopening a thread,
  draft restore delay, keyboard dismissal and viewing run results.
- Consider a bottom menu prototype only after testing reachability. No global
  vertical swipe navigation or second parallel menu has been introduced.
- Device checks: Inbox startup, approval then project return, attention
  notifications, local mode, restored drafts, keyboard and large fonts. Also check
  Add step sheet keyboard dismissal/reopening, nested child-to-parent Back, and
  child completion/delete/undo through the existing detail screen.

No data deletion or server contract change is required for this stage.

## State-aware project task actions (v1.4.27)

- Desktop and Android now emphasize one action for a selected project task:
  run a Ready leaf, open an active execution, answer a waiting agent, review a
  result, or open task details for blocked/completed/human work.
- Active execution takes precedence over an older Ready graph snapshot. Missing
  telemetry or a missing active run id does not offer a new run. Server-side Ready
  validation and the existing explicit run confirmation remain required.
- Desktop puts step/expand/discuss/details in a collapsed Actions section;
  Android keeps task detail/chat in its overflow menu, omitting duplicate Details
  when it is already the primary action. No execution is started by opening a run.
- Android reads the existing project-filtered execution telemetry endpoint with
  its workspace request scope on project refresh. It does not add background
  polling; the refresh button updates status after external changes. Desktop
  reuses the existing telemetry query's polling and run-thread resolution.
- Device checks remain: keyboard/overflow accessibility, large text, review or
  input thread selection, and refresh after an agent changes state elsewhere.

## Task detail progressive disclosure (v1.4.27)

- Android combines title, completion, due date and task conversation access into
  one card. A Details disclosure contains additional status choices, description
  and tags. It is scoped to the task; the bottom note composer and steps remain.
- Relationship rows, relationship loading/errors and note/step errors stay
  visible. Only an empty relationship placeholder follows the Details disclosure.
- Desktop collapses unconfigured recurrence and skill choices. Existing recurring
  schedules and assigned-skill status remain visible. The existing Details button
  exposes its expanded state to assistive technology and resets on task navigation.
- No server behavior, task statuses or execution permissions change. Verify on
  devices with large text and screen readers, including expanding Details,
  changing status and returning from a child task. Automated checks do not replace
  those device checks.

## Retire task recurrence (unreleased)

- Remove Repeat from desktop task detail and recurring badges from desktop task
  cards and Android task detail. Due dates and ordinary task completion remain.
- Quick capture no longer extracts recurrence from task text or sends a task
  recurrence rule. Recurrence phrases remain in task titles; calendar events
  retain their separate recurrence parsing and editor.
- Single, bulk and chat task completion no longer spawn follow-up occurrences.
  The task recurrence generation service is removed. Existing tasks and stored
  historical metadata are not deleted, and no database migration is required.
- Retain legacy API fields for older clients, but ignore recurrence on task
  create/update and report tasks as non-recurring. Apply the updated server as
  well as the client: an old server can still generate repeated tasks.
- Calendar event recurrence, imported calendars and their reminders are unchanged.
