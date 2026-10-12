# Companion validation scope

This is an experimental source implementation, not a certified mobile release. Source/build checks and older physical-device checks establish different things.

## Source integration

The companion incorporates upstream MonoCode `v0.13.0` ([633730d](https://github.com/hardbeat920/monocode/commit/633730d70dd3e6cb8113af28c062dd1ea9228c0d)). Integration checks passed on October 12, 2026: 5,262 desktop unit/component tests, 85 companion UI tests, 662 native tests with one ignored, eight release-channel tests, both frontend builds, TypeScript, Rust formatting, and Clippy. The dedicated Companion CI run also passed.

These counts describe the source integration checkpoint. They do not claim a newly installed physical-device build, provider compatibility across all agents, or an independent security audit. Public CI validates the exported source separately.

## Physical-device evidence

An earlier signed iPhone build was paired to the isolated Mac host. Same-session delivery after lock/reopen was independently confirmed in the Mac transcript. A separate Wi-Fi-off cellular check was user-confirmed, with the message and reply independently recorded in that same session. Automatic versus manual reconnect was not distinguished in the resume check.

Allow completed a bounded test write; Deny and Stop prevented their test files from being created on an earlier device build. These checks establish exercised controls, not coverage of every provider, permission mode, lifecycle race, or later source revision.

## Simulator screenshots

The README images were captured directly from an iPhone Simulator running iOS 18.6 on October 12, 2026. They show simulated workspace data, approvals, Inbox, and QR-pairing onboarding. They contain no live provider data or usable pairing invitation. Screenshots establish presentation, not real transport or camera behavior.

## Outstanding

- Long suspension, repeated Wi-Fi/cellular handoffs, and interrupted-command recovery.
- Physical keyboard/safe-area behavior, large text/landscape, VoiceOver, and motion/transparency preferences.
- Live Inbox/provider data, artwork/fonts, and the range of supported agent adapters.
- Durable desktop reconciliation, push/event replay, release signing/distribution, and relay service operations.

Lighthouse is not applicable to native Tauri/WKWebView surfaces. Native UI inspection, DOM tests, platform builds, and controlled device checks provide the relevant evidence. Compatibility below the tested iOS 18.6 runtime has not been established.
