# Uniform interface polish

Local implementation on top of `fcdb90c`. No protocol changes, dependencies, native effects or new actions. The attention and queued-follow-up features still require matching future desktop and phone builds; installed beta.2 and TestFlight 1004 are unchanged.

## Shared rules

`src/styles/motion.css` extends the existing timing tokens and is imported by desktop and phone styles. Feedback uses 120ms, small surfaces/status acknowledgments 160ms, and forward/back navigation 220ms, with the existing ease-out curve. Reorder stays 160ms and tab closing 200ms. JavaScript reads the same tokens, preserves an explicit zero and honors OS reduced motion.

PanelStack keeps covered pages mounted, removes departing pages immediately for reduced motion, cancels obsolete removals on quick reopening, and restores a still-mounted opener without scrolling. Reduced-transparency users receive solid shared dialog/popover backdrops.

## Surface coverage

| Surface | Behavior and visual treatment |
| --- | --- |
| Home and navigation | Quiet Mono identity/basic status remains unchanged. Needs you stays separate, with a consistent chooser surface and feedback. Group/project chevrons and reveal feedback share timing; no animated list heights. |
| Mac Mono overview | Existing overview remains the active-work route. Panel navigation shares timing with the phone; expanded tab labels retain their existing grid transition. Project/branch captions use readable secondary contrast. |
| Mono details | One restrained content entrance replaces staggered child entrances; captions use the shared phone secondary contrast. |
| Chat and activity | Streaming text and scroll ownership are unchanged. A running activity group stays open on completion, preserving the reader's inspection. Explicit collapse still wins. Status changes use a finite opacity acknowledgment. |
| Send and Stop | Both controls remain available while working. The composer reserves receipt space; Send/Stop acknowledge only an actual accepted Mac receipt, including retry. Queue wording remains queued, not delivered. |
| Settings | Shared feedback and phone header icon sizing; desktop explicit press durations now read the common token. Theme, font and 100% phone text scale remain unchanged. |
| Inbox | Existing cached refresh behavior remains. Phone Back restores list scroll and focused row; shared surface/navigation timing and secondary contrast apply. |
| Changes and file review | Refresh retains the inspected diff until its result and retains it on failure. A reserved loading line avoids refresh insertion shifts. Fold controls keep 44px phone targets. Desktop diff rendering, line markers and virtualization remain unchanged. |
| Pickers and dialogs | Shared entrance timing, soft surface depth, selection feedback, keyboard focus and solid reduced-transparency fallback. Existing placement, dismissal and nested Escape behavior remain. |
| Connection and pairing | Shared button/input feedback, focus treatment and readable secondary labels apply without changing pairing or reconnection behavior. |
| Loading and completion | Existing workspace/Inbox/Mono snapshots remain visible during refresh. Activity completion does not collapse inspected content. Receipt/status animation ends after one short acknowledgment. |

Phone targets retain 44px touch geometry; desktop keeps its denser controls. Large navigation/disclosure heights and streamed text are deliberately not animated: chevrons, opacity and preserved content explain changes without moving the reading position. Mascot/idle effects, tab-animation preferences and existing chat effects retain their own controls.

## Validation and limits

Focused tests cover transition cleanup/reopening, focus restoration, runtime reduced-motion changes, explicit zero timings, activity completion, failed refresh retention and accepted/rejected Stop receipts. Existing attention, queue, approval/turn and draft tests remain in the companion regression suite.

Headless Chromium/WebKit fixtures cover light/dark 390×844 phone surfaces, narrow 320px streamed content, Mac overview/dialogs, rapid navigation, queue receipts, review, pairing, reduced motion and drag behavior. Reduced-transparency emulation is checked in Chromium; WebKit/native preference behavior still needs physical-device verification.

Production Lighthouse comparisons preserve the simulated-mobile result separately from unthrottled localhost measurements. Native-app SEO metadata and fixture favicon findings are documented in the project evidence report. No installed app or live profile was touched.
