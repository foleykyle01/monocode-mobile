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
- `npm run test:browser -- tests/browser/phone-transcript-scroll.spec.ts` — 4 portrait Chromium/WebKit cases covering delayed hydration, late layout, A → B → A, linked-session return, manual reading, viewport resize, and prepended history.
- `npm run test:browser -- tests/browser/interface-polish.spec.ts --grep "a narrow phone"` — 2 Chromium/WebKit existing streaming-anchor cases.
- `npm run test:browser -- tests/browser/mono-linked.spec.ts --grep "a Mono opens its project sessions"` — 2 Chromium/WebKit existing linked-session/draft cases.

Implementation commit: `9df8992` (`fix(companion): open chats at latest`).

## Scope and limits

- This changes only the iPhone Companion React UI; no desktop transcript,
  sidebar, dot, or packaging source is included.
- Playwright exercised browser fixtures, not a physical iPhone, simulator, or
  signed-in profile. No application/device launch, package install, release,
  queue, clipboard, or live action was performed.
- A prior wrong-platform Mac implementation was preserved locally at
  `hold/wrong-platform-desktop-chat-open-latest` (`59653ab`) and reverted from
  this branch by `3023449`; it is not part of this phone fix.
