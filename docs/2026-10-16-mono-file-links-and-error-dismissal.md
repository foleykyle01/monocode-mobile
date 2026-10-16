# Mono file links and error dismissal

Source: `826358668b1bed3763beb69b495daab05eca9898` (public `main`), implemented on the local `fix/mono-file-links` worktree.

## Reproduced cause

The reported original Markdown link was not available, so this change does **not** claim to reproduce a particular malformed user link. A synthetic link to `file:///Users/me/Downloads/Workflow%20Diagram%25.html:18:4` was used instead.

Before this change, Markdown already decoded that link and retained its source position, but the file-open callback used the currently active git/sidebar CWD. `resolveOpenablePath` could then consult that unrelated project's index and substitute a same-named file by basename. The floating Mono action also reduced an open-file request to only its path, dropping navigation and ownership context.

The non-dismissible banner had separate causes:

- `MonoComposer` kept its local attachment/delivery failure with no dismiss control.
- Floating Mono combined local action failures with `View.error`, a host snapshot field. Clearing local state could not clear the host field, so ordinary snapshot updates restored the banner.

## Behavior after the change

- Markdown/document links carry their parsed exact path, line/column, and originating session worktree through embedded, docked, floating, and remote Mono routes.
- The desktop host opens the tab under the source worktree instead of the unrelated active project. Explicit absolute paths, file URLs, home paths, Windows paths, and remote paths do not fall back to a same-named indexed project file.
- Relative references still resolve against the originating Mono/session CWD. Existing file/editor and media/HTML preview handling remains in place.
- A missing explicit path remains missing and reaches the existing reader error; MonoCode does not search the filesystem by basename or add Downloads as a project.
- Composer-local errors have an accessible dismiss button that leaves drafts and attachments alone. Floating host errors have an accessible dismiss button scoped to the displayed Mono and error generation. It survives snapshot refreshes, while a later error generation is visible again. Runtime transcript errors, approvals, drafts, and session state are not cleared or hidden.

## Validation

- `npm run test -- src/features/files/model/fileIndex.test.ts src/features/sessions/ui/AgentMarkdownFileLinks.test.ts src/features/sessions/ui/AgentMarkdownMenu.test.ts src/features/monos/model/floatingMono.test.ts src/features/monos/ui/FloatingMonoChat.test.ts src/features/monos/ui/MonoComposer.test.ts src/features/monos/ui/FloatingMonoChat.motion.test.ts src/features/connections/ui/RemoteSession.test.ts` — 8 files, 113 tests passed.
- `tsc --noEmit` — passed.
- `cargo fmt --check` — passed.
- `cargo test mono_chat --lib` is blocked before Mono tests by the unchanged release-commit updater source: `src-tauri/src/safe_updater.rs` references `tokio`, which is not declared in this worktree's Cargo dependencies. That pending updater issue was not modified.

No user profile/database, Downloads contents, native app instance, release artifact, or executable HTML trust policy was accessed or changed.
