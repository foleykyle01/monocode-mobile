# Inbox and Changes

The companion keeps Monos above the existing group → project → session hierarchy. Inbox is a separate home entry. Each project has a Changes button; its workspace selector can review the project workspace or an available session's worktree.

Both new views are read-only. Inbox mirrors the Mac's configured providers and saved filters, supports local search, and opens item descriptions. It does not start work, mark notifications read, or change tracker state. Changes separates staged and unstaged files and displays unified text diffs with line numbers and expandable context. It does not stage, commit, push, merge, or discard files. Existing chat and project session creation remain available.

The Mac advertises these capabilities and resolves project/session identifiers to local workspaces. Provider credentials stay on the Mac. New native protocol operations are limited to `inbox.list`, `inbox.read`, `changes.list`, and `changes.read`; tests explicitly reject the removed action names.

Inbox returns at most 100 items from the desktop filters. The description renders immediately up to a 16,384-character transport page; longer descriptions have an explicit Load more control. The Summary also projects provider discussion and PR changed-file totals/list. Discussion is bounded to 50 total comments/replies, six nesting levels, and 8,192 characters per comment; changed files are bounded to 60. Limits and provider failures are visible. Appending pages from a different desktop epoch is rejected.

Changes lists at most 200 files using Git index metadata. Opening a file checks that it is still advertised in the requested staged/unstaged section and loads only that file's current diff, with each side limited to 64 KiB. Unrelated edits do not invalidate this read-only view. Metadata revisions remain compatible with older phone clients; the current client checks the desktop epoch and selected target instead of requiring an unchanged whole-workspace revision. Binary, oversized, and symbolic-link files need Mac review. Unix native reads reject symbolic links without following them, avoid FIFO blocking, and limit reads to the existing native text-size threshold plus one byte.

Inbox uses desktop provider/action icons, compact navigation, and reduced-motion-aware transitions. Markdown, tables, code, and diffs wrap within the phone width rather than scrolling horizontally.

## Validation and remaining work

Focused UI tests cover read-only navigation, item detail, stale responses, workspace selection, diffs, and the absence of action controls. Desktop tests cover read routing, authorized identifiers, bounds, and stable revisions. Native tests cover protocol rejection, existing pending-command behavior, symbolic links, FIFOs, and oversized files.

Use `npm run companion:preview` for sample data. The simulator uses the same shared UI with `?demo=1`. Sample browsing contacts no providers. Live provider accounts and a paired physical iPhone still need a later end-to-end check. The daily MonoCode app is untouched; rebuilding the isolated desktop does not restart its existing process. Lighthouse is not applicable to these native WKWebView surfaces; native UI inspection and DOM behavior tests are used instead.
