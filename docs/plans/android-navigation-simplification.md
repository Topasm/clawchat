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
