# Mono file links and error dismissal

Source: `826358668b1bed3763beb69b495daab05eca9898` (public `main`), implemented on the local `fix/mono-file-links` worktree.

## Reproduced cause

The reported original Markdown link was not available, so this change does **not** claim to reproduce a particular malformed user link. A synthetic link to `file:///Users/me/Downloads/Workflow%20Diagram%25.html:18:4` was used instead.

Before this change, Markdown already decoded that link and retained its source position, but the file-open callback used the currently active git/sidebar CWD. `resolveOpenablePath` could then consult that unrelated project's index and substitute a same-named file by basename. The floating Mono action also reduced an open-file request to only its path, dropping navigation and ownership context.

The first fix carried the source working copy through resolution, but `App` still selected the active workspace tab and associated that working copy with its project. When Mono B opened a file while project A was active, that could still make the editor appear under A. The follow-up route now chooses B's containing tab by source session ID (with source-worktree fallback), keeps `sourceCwd` separate from `sourceProjectCwd`, and limits workspace-mode reuse to B's project/tab.

The non-dismissible banner had separate causes:

- `MonoComposer` kept its local attachment/delivery failure with no dismiss control.
- Floating Mono combined local action failures with `View.error`, a host snapshot field. Clearing local state could not clear the host field, so ordinary snapshot updates restored the banner.

## Behavior after the change

- Markdown/document links carry their parsed exact path, line/column, source working copy, source project, and source session through embedded, docked, floating, and remote Mono routes.
- The desktop host selects the originating Mono workspace (or a new file-only workspace carrying its owner context when that session is no longer mounted), never the unrelated active project. It preserves the worktree for resolution and the project for visible ownership. Explicit absolute paths, file URLs, home paths, Windows paths, and remote paths do not fall back to a same-named indexed project file.
- Relative references still resolve against the originating Mono/session CWD. Existing file/editor and media/HTML preview handling remains in place.
- A missing explicit path remains missing and reaches the existing reader error; MonoCode does not search the filesystem by basename or add Downloads as a project.
- Composer-local errors have an accessible dismiss button that leaves drafts and attachments alone. Floating host errors have an accessible dismiss button scoped to the displayed Mono and error generation. It survives snapshot refreshes, while a later error generation is visible again. Runtime transcript errors, approvals, drafts, and session state are not cleared or hidden.

## Validation

- `npx vitest run src/features/workspace/model/fileOpenRoute.test.ts src/features/files/model/fileIndex.test.ts src/features/sessions/ui/AgentMarkdownFileLinks.test.ts src/features/sessions/ui/SessionPaneMessaging.test.ts src/features/monos/ui/FloatingMonoChat.test.ts src/features/connections/ui/RemoteSession.test.ts` — 97 tests passed. The new connected routing cases cover non-workspace and workspace tab modes with Mono B, unrelated active A, an exact Downloads path containing a space and `%`, distinct worktree/project CWDs, line/column navigation, and an identical path already open under A.
- `npx tsc --noEmit` and `npm run build` — passed. The production build emitted existing CSS pseudo-element and chunk-size warnings only.
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml` — passed.
- `cargo test mono_chat --lib --features companion-spike -j 2` — 13 tests passed. `companion-spike` enables the optional `tokio` dependency declared in `src-tauri/Cargo.toml`, so this is the applicable Mono feature configuration. The unrelated default-feature updater configuration was not changed.

No user profile/database, Downloads contents, native app instance, release artifact, or executable HTML trust policy was accessed or changed. The missing-file screenshot remains a meaningful reader error; without the original raw link, it cannot establish whether that link itself was malformed.
