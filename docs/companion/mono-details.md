# Mono details and navigation polish

## Linked project sessions (next build)

A Mono's conversation shows cards for project sessions it launches. Each card shows the live session title, project folder, and activity. Opening it uses the regular project chat, including messaging, approvals, questions, and Stop. Back (or the phone's edge swipe) returns to the Mono and restores its loaded transcript, reading position, and draft. Each session retains its own draft.

The Mac adds optional `spawnedSessions` summaries to the final transcript block of each user turn, resolving existing launch records and legacy receipts against live, eligible, listable sessions. Deleted, hidden, or excluded targets are omitted. Each turn is capped at 20 cards; transcript paging remains bounded, and launch records before the latest page still resolve at their turn's tail. Repeated references in different turns remain visible. All controls reuse existing session ID, epoch, turn, approval, and mutation-journal checks.

Both apps need this source update. TestFlight 1004 and Mac beta.2 do not contain it. Automated bridge, phone, and browser checks cover the interaction; physical-device verification against a rebuilt Mac remains pending.

Validation on October 14: 101 phone tests, 48 bridge/launch-model tests, TypeScript, production UI builds, and the mobile interaction in Chromium and WebKit passed. Lighthouse used the production sample UI (`/?demo=1`): workspace Performance 93 / Accessibility 95 / Best Practices 93 / SEO 83; Mono-card and linked-session snapshots each Accessibility 100 / Best Practices 100 / SEO 60. Snapshot mode does not measure navigation performance. SEO is exempt for this native app surface (no public indexable routes, metadata, or robots file). Remaining workspace findings include existing contrast, bundle size, and an HTTP-preview-only favicon 404.

## Workspace and details

Home retains Monos → groups → projects → sessions. Mono cards show identity and a basic Working / Needs you / Idle state, without detailed tool or activity narration. A separate conditional Needs you shortcut opens pending questions and approvals. The card opens chat; its separate details button opens a read-only profile without replacing the chat draft. Search opens on its own full-width row with no activity dropdown. Text is fixed at 100% by user preference; desktop fonts/colors still apply, but desktop zoom and preview text-size choices do not. See [attention, lifecycle, and follow-up compatibility](attention-session-status.md) for the next-build behavior.

Connection status is a notification dot on the Settings gear, with connected, reconnecting and unreachable states and an accessible status description. The former bottom status area is removed; all recovery controls remain in Settings.

The toolbar has a small MonoCode Mobile title on the left and Search and Settings on the right. Inbox sits above the Monos heading and roster. The Monos heading scrolls with its cards and is a disclosure with a roster count. Collapsing it leaves Inbox and the group/project hierarchy visible, and the state survives workspace polling and chat navigation. Entering a search expands Monos to reveal matches. The connection badge sits slightly outside the Settings button's upper-right edge.

The new `monos.read` operation is allowlisted by the encrypted host and local desktop bridge. It accepts an advertised Mono ID plus an optional `soul`, `memory`, or `habits` section and offset. It does not accept paths or write commands. The desktop resolves projects through the same normalized keys as navigation and returns the current model, access, model settings, Soul, Memory, and habits with scheduling/outcome/run information.

Soul and Memory pages allow 120 lines and 24 KiB of text. A single oversized line is explicitly marked shortened. Habit pages contain five habits with up to 20 bounded run reports each, leaving room inside the transport's 4 MiB response cap. Existing secret redaction applies to file text and habit instructions/reports. The UI reports shortening, offers page controls, rejects changed-epoch/cursor append responses, and supports Refresh/Retry. Additional memory-topic files are not exposed.

Native `mono_read` no longer creates missing folders, seeds memory, or migrates legacy storage. It can read the legacy store in place; ordinary desktop load/save retains initialization. A missing Soul uses the desktop's pure default/instructions projection without persisting it; an intentionally empty Soul stays empty.

Navigation and controls reuse the desktop icon set. Glass styling is a restrained WebView approximation using inherited colors, translucent fills, soft edges, and blur—not Apple's native Liquid Glass renderer. Reduced transparency uses solid fills. Compact circular Back controls retain 44-point targets; Inbox and detail transitions honor reduced motion. Running chats use a transcript shimmer, Send, and a distinct composer Stop button. Follow-ups enter the desktop queue/steering path when the host advertises support. Approval and Stop still carry the existing exact session/turn preconditions.

The phone layout does not scroll horizontally. Long Markdown/code/table content and diffs wrap; diff line-number columns remain separate. Mac preview checks include Home, Inbox summary/discussion, Mono details, busy-to-idle Stop, and light appearance at 200% text size. Focused automated checks cover read-only boundaries, stale replies, paging, drafts, approval Stop, and activity state. Live provider data and a physical iPhone still require a later check; rebuilding the isolated desktop does not restart its active sessions.
