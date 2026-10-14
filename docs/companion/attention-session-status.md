# Attention, linked-session status, and follow-ups

Published in [PR #13](https://github.com/foleykyle01/monocode-mobile/pull/13). This source slice requires matching Mac and phone builds and is not included in Mac beta.2 or TestFlight 1004. See [release setup](release-setup.md) for delivery status. A phone update alone cannot enable missing host capabilities; app installation and profile changes remain a separate handoff.

## Attention and home

The phone workspace has a conditional **Needs you** entry, separate from Mono cards. It deduplicates pending questions and approvals by session ID across the Mono roster and project sessions. One waiting session opens directly; several use a compact keyboard-accessible chooser. Opening a target focuses its pending question or approval, paging older transcript content when necessary, without submitting a decision. After resolution, **Next waiting session** reaches remaining work.

Home Mono cards show identity and a basic Working / Needs you / Idle state only. Detailed activity stays in conversations. Project/session dots, ordering, search, collapse, per-session drafts, loaded history, and reading positions remain in place. Phone text stays at 100%.

The Mac Mono overview provides the analogous entry for its launched sessions. Several targets use the existing Sessions list and attention filter; a single target opens directly. Pending controls receive focus and remaining work stays reachable. The overview remains the active-work route; there is no new dashboard or home action cluster.

## Lifecycle compatibility

Session summaries optionally include `lifecycle`: `working`, `input`, `draft`, `failed`, `stopped`, `done`, or `unknown`. Both platforms use the desktop `launchedSessionState` projection. A settled user-turn duration is required for Done, with failure/interruption notices taking priority. An idle session alone is not evidence of success. Legacy hosts without lifecycle data show Working or Needs input when known, otherwise Status unknown.

Linked cards use concise labels and a fixed icon slot. State acknowledgment is brief and disabled under reduced motion. Compact navigation rows retain their dots.

## Send while working

`sessions.list.capabilities.queuedFollowUps` advertises support. The phone keeps Send and a separate 44-point Stop target visible during work. Older hosts keep busy Send disabled with an update explanation. Offline, reconnecting, stale epoch/turn, and unconfirmed-command states disable mutations; submission acknowledgment briefly protects the input. A rejected send retains its draft, and an uncertain send restores its saved text after phone relaunch.

The same `sessions.send` command validates eligibility, session ID, renderer epoch, turn, handoff/workspace state, and existing saved draft. Busy sends and sends behind an existing queue append to the desktop outbox using a path-safe ID derived from the receipt identity. Earlier messages, paused state, and drafts are preserved. The owner persists the queue before returning `delivery: queued`. Idle sends retain the existing submission path and return `delivery: accepted`.

Delivery uses the desktop queue pump. Monos retain their existing readiness-based steering. Project sessions honor the desktop Queue/Steer preference (including the existing background-task exception), provider capability, and head-of-queue order. Steering uses the existing acknowledged-delivery path, checking the exact queued message and turn generation after preparation; it retains the message on failure or a turn-ending race. Blocking questions and approvals hold delivery. No send invokes Stop or cancels the active turn.

`sessions.read.queuedMessages` exposes queued, paused, or failed messages; internal Mono completion reports are excluded. The phone displays queued work distinctly from delivered transcript messages. The existing native command journal and renderer receipts keep retries idempotent, including concurrent retries; an old renderer epoch remains a review/recovery case rather than being replayed. Desktop composers already accept busy submissions, so their send/stop UI is unchanged.

## Verification and remaining checks

Focused automated coverage includes deduplication, attention navigation, legacy outcomes, minimal home content, concurrent retry, preserved queues/drafts, persistence serialization, queue/steer gating, stale identity, offline recovery, session switching during acknowledgment, and restored unconfirmed sends. Browser fixtures cover Chromium and WebKit at 390×844, light/dark, reduced motion, Send/Stop geometry, the linked round trip, and the Mac overview route.

Physical Mac/iPhone verification remains required with matching new builds: real provider steering/queue delivery, multiple rapid sends, approval/question resolution, Stop/failure outcomes, keyboard layout, suspension/reconnect, and relaunch. No Rust code or native command envelope changed; Rust tests and native packaging/install are outside this local source validation.
