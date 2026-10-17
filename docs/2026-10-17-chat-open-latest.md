# Mac chat opens at latest

Source: `960e2ea8128825fcafb6f10598485fb0250c43c5` (installed beta9 source), implemented on local branch `fix/chat-open-latest` in `monocode-chat-open-latest/`.

## Cause and change

`AgentTranscript` treated a pooled revisit as a request to restore the reader's previous distance from the bottom. A chat opened after switching away could therefore restore hundreds of pixels above its newest message; a hidden-mounted tab likewise left a deliberate earlier position unchanged on return.

The shared visible-visit layout effect now pins to the latest turn exactly once when a transcript becomes visible. The existing follow state still releases after real reader input, so stream/layout commits do not move someone reading earlier history. Search and explicit anchor navigation run after the visit transition and retain their own target position. Pooling, parsed DOM reuse, pagination/prepend anchors, composer motion, reduced-motion behavior, and mobile code are unchanged.

## Reproduction and verification

Before the source change, the new real-browser fixtures failed as intended:

- A hidden-tab revisit remained 398px above the end.
- A pooled A → B → A revisit restored 640px above the end after layout settled.

After the change:

- `npx vitest run src/features/sessions/ui/AgentTranscriptScroll.test.ts src/features/sessions/ui/AgentTranscript.firstPaint.test.ts src/features/sessions/ui/AgentTranscript.search.test.ts src/features/sessions/ui/TranscriptPool.test.ts src/features/sessions/ui/SessionPaneScroll.test.ts src/features/sessions/ui/AgentTabView.test.ts src/features/sessions/hooks/useBottomChatMotion.test.ts` — 64 tests passed.
- `npm run test:browser -- --project=chromium tests/browser/transcript-scroll.spec.ts tests/browser/tab-revisit.spec.ts` — 9 browser fixtures passed.
- `npm run test:browser -- --project=webkit tests/browser/tab-revisit.spec.ts` and `npm run test:browser -- --project=webkit tests/browser/transcript-scroll.spec.ts` — 9 browser fixtures passed. Chromium and WebKit cover fresh hidden hydration, late content while pinned, manual reading after later commits, and pooled A → B → A return-to-latest behavior using real rendered scroll geometry.
- `npm run build` — TypeScript and production Vite build passed. Existing CSS `::highlight(...)` optimizer and chunk-size warnings remain.

## Limits

No native app or signed-in profile was launched or changed; no package install, packaging, restart, queue, clipboard, live session, action, or mobile change occurred. Lighthouse was not run because this checkout has no Lighthouse binary and installing one was out of scope; the targeted Playwright coverage is the browser validation for this scroll-only change.
