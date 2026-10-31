# iPhone chat opens at latest

## Cause

`Workspace` stored each Companion transcript's scroll offset and passed it back to
each newly keyed `Transcript`. Once delayed history finished loading,
`Transcript` restored that offset and turned off following. A reopened or linked
chat could therefore stay above its latest message.

## Change

- Removed the Companion-only saved-offset handoff and the obsolete transcript
  restore props.
- New transcript visits retain their existing initial following behavior, so
  hydration and later layout growth land at the newest message.
- Kept the existing deliberate-scroll, explicit approval attention, and
  prepended-history anchor behavior. Drafts, image staging, queue/retry state,
  and transcript expansion state are not remounted or reset.

## Evidence

Before the change, the focused phone test reproduced the defect after delayed
hydration: it expected `scrollTop` `1000` and received the cached `123`.

Passed checks:

- `npm exec -- vitest run --config companion/ui/vitest.config.ts Transcript.test.ts CompanionApp.test.ts history.test.ts` — 56 tests.
- `npm run companion:build` — Companion TypeScript check and Vite build passed.
- `npm run test:browser -- tests/browser/phone-transcript-scroll.spec.ts` — 4 portrait Chromium/WebKit cases covering delayed hydration, A → B → A, linked-session return, history anchors, and a ResizeObserver-driven rendered-content reflow with unchanged transcript blocks. Wheel input confirms intentional reading survives that reflow, streaming, and viewport resize.
- `npm run test:browser -- tests/browser/companion-open-latest.spec.ts` — 2 portrait Chromium/WebKit runs of the real demo Companion route: hidden initial Mono hydration, same-ID Mono and project reopening after Back to workspace, the workspace Settings detour, and a linked-sessions overlay that preserves manual reading.
- `npm run test:browser -- tests/browser/interface-polish.spec.ts --grep "a narrow phone"` — 2 Chromium/WebKit existing streaming-anchor cases.
- `npm run test:browser -- tests/browser/mono-linked.spec.ts --grep "a Mono opens its project sessions"` — 2 Chromium/WebKit existing linked-session/draft cases.

Implementation commit: `9df8992` (`fix(companion): open chats at latest`).
Coverage follow-up: `ba5760a` (`test(companion): cover same chat reopening`); it adds tests only, because the real paths passed without another production behavior change.

The coverage follow-up initially used a broad `.transcript` locator and recreated
the fixture's `blocks` array during the synthetic reflow. The real project
navigation test could consequently resolve a hidden prior Mono transcript, and
the reflow did not prove `ResizeObserver` behavior with unchanged blocks. The
final fixture memoizes blocks without `reflowHeight`, waits two animation frames
for the observer delivery, and scopes the demo test to the visible detail pane.
It waits for the expected title, hydrated content, nonzero viewport, and actual
overflow before real wheel input. It also tags each same-ID transcript DOM node
and confirms it survives reopening, so the test does not pass via a remount.

Final follow-up check:

- `./node_modules/.bin/playwright test tests/browser/phone-transcript-scroll.spec.ts tests/browser/companion-open-latest.spec.ts` — 6/6 passed: Chromium and WebKit each ran both unchanged-block reflow/manual-reading cases and the real Mono/project same-ID reopening route.

Test hardening commit: `55b1a68` (`test(companion): harden phone opening paths`).

## Scope and limits

- This changes only the iPhone Companion React UI; no desktop transcript,
  sidebar, dot, or packaging source is included.
- Playwright exercised browser fixtures, not a physical iPhone, simulator, or
  signed-in profile. No application/device launch, package install, release,
  queue, clipboard, or live action was performed.
- Reconnect and uncertain-response opening paths were not exercised by the
  browser follow-up; the existing focused Companion unit coverage remains the
  only automated coverage for delayed recovery selection.
- A prior wrong-platform Mac implementation was preserved locally at
  `hold/wrong-platform-desktop-chat-open-latest` (`59653ab`) and reverted from
  this branch by `3023449`; it is not part of this phone fix.
