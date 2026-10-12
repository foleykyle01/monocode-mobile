# Companion chat parity

The phone delegates conversation ownership to the existing Mac session. It does not start a second provider session.

## Questions

`sessions.read.pendingQuestion` contains the shared desktop `UserQuestionPrompt`; the UI reuses `QuestionForm`. `sessions.answer` validates the renderer epoch, session turn, current question ID, choices, custom-answer permissions, single/multiple selection, and payload limits before calling the desktop question handler. Partial replies and Skip preserve desktop semantics. A question is claimed before dispatch; a second device cannot answer it again. Uncertain outcomes retain the original request ID and nested payload in the native journal.

`sessions.question.keepOpen` forwards the first interaction with a timed question. The phone serializes a simultaneous submit behind that request so its single-command journal remains valid. The host still owns expiry; a late answer fails closed. Prompts over 32 KiB, 20 questions, or 50 choices per question require Mac review rather than presenting shortened options.

## Activity tree

Snapshots carry bounded labels, tool kind and state using the desktop activity helpers. Consecutive tools and reasoning form a collapsible connected tree. Live groups open automatically, settled groups collapse, and individual outputs remain expandable. Pending approvals retain their dedicated Allow/Deny controls. Delegated runs expose at most 20 recent child steps, with an explicit truncation note. No transcript polling interval or history retention limit was increased.

## Session changes

`sessions.review.list` and `sessions.review.read` read the existing checkpoint APIs using the same session edited-path scope as the desktop card. The bridge resolves the authorized session and worktree; callers never supply a filesystem root. Reads are rejected while the turn/worktree is changing and revalidated after asynchronous loading.

The phone fetches the summary when a session settles or reconnects, not on every transcript poll. Only the selected file's original/current contents are loaded. The list is capped at 200 entries; combined diff text is capped at 64 KiB. Unrecorded originals are reported as unavailable. No Keep/Undo or Git-write command is exposed.

## Validation

The automated checks cover question choices/custom answers/skipping, stale and duplicate decisions, uncertain retry preservation, checkpoint membership/path restrictions, read races, bounded payloads, and UI interaction. A Codex adapter integration test sends a simulated provider question through the bridge and verifies a single correctly formatted provider response after duplicate retry. Native preview checks use sample data and do not contact an agent.

On October 12, 2026, matching Mac and signed iPhone builds were installed. The phone reconnected with its existing pairing and projects. A real Claude single-choice question was answered on the phone; the Mac independently recorded `PHONE_QUESTION_READY` and no remaining pending question. This confirms that exercised question path, not every provider or question variant. Software keyboard/custom answers, timed expiry, and the new recorded-diff interface still need physical-device checks. Source changes alone do not upgrade existing installations.
