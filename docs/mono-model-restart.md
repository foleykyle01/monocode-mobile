# Mono model-session restart

Status: local implementation only; not installed, published, or merged.

## Behavior

- Claude Monos expose **Restart model session** in their model picker. It kills
  only the cached Claude child and retains the Mono transcript, provider resume
  identity, task state, drafts, identity/memory, linked children, and model /
  access settings. The next message starts a fresh Claude process and resumes
  that conversation with its current configuration.
- The action is disabled while the parent Mono is busy, awaiting an approval or
  question, switching/handoffing, restarting, preparing/removing a worktree,
  or holding queued messages. It does not inspect or cancel child sessions.
- The picker confirms successful deferred reloads and displays runtime errors.
  Other providers do not show this action because their resume semantics have
  not been verified for this workflow.

## Validation

- `vitest run src/integrations/harness/providers/claude/claudeLive.test.ts src/integrations/harness/core/registry.test.ts src/features/monos/model/monoModelRestart.test.ts src/features/sessions/ui/ModelPicker.test.ts src/features/sessions/ui/SessionPaneMessaging.test.ts` — 97 passed.
- `tsc --noEmit` — passed.
- `git diff --check` — passed.

The focused provider test proves the cached Claude child is killed, a later
turn launches a fresh process with `--resume sess_1`, and runtime disposal
failures reach the UI. Coverage is intentionally limited to Claude; no live
profile, application, or provider session was manipulated.

## Files

- Runtime capability and Claude lifecycle: `src/integrations/harness/**`
- Mono state guard and owner wiring: `src/features/monos/model/monoModelRestart.ts`, `src/app/App.tsx`
- Picker surface and focused UI tests: `src/features/sessions/ui/**`

Commit: `d76b440` (`Add Mono Claude model session restart`).
