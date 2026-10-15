# Mac beta.5: published download, updater gate incomplete

October 15, 2026. **1.0.0-beta.5**, Apple Silicon arm64, `MonoCode Dev`, identity
`com.monocode.companion-spike`, Developer ID team `RBT45GBH6K`.

The expanded Mono rail now combines status and unread count in one aligned badge:
Needs you and Working take priority over completed unread. The badge remains
visible beside options; grouped project indentation and compact/floating layouts
are preserved. No iPhone update or protocol change is needed.

## Source and packages

- [PR #17](https://github.com/foleykyle01/monocode-mobile/pull/17), merge
  `3503aab10d23b26f3fdd7334e26920b9b3f70397`, has the same Git tree as reviewed
  build source `2963ec7d7235961323150e5532ea3bb9522e6861`.
- [Required CI](https://github.com/foleykyle01/monocode-mobile/actions/runs/38778518836)
  and [main CI](https://github.com/foleykyle01/monocode-mobile/actions/runs/38779540312)
  succeeded. Parent review included 20 focused tests, TypeScript and six
  Chromium/WebKit checks. Native packaging/typecheck/build also passed.
- [Immutable prerelease](https://github.com/foleykyle01/monocode-mobile/releases/tag/companion-mac-v1.0.0-beta.5)
  contains the DMG, signed updater archive, signature, checksums and versioned
  candidate manifest. All five assets were downloaded anonymously and hash-matched.

App notarization `9667be4a-c17b-444e-89ca-30a939afdd3f` and DMG notarization
`eb906c3b-f765-4cb0-941c-ac220d234fb2` were Accepted. Both were stapled; strict
signatures, Gatekeeper, embedded feed/key, architecture/version, updater minisign
and full app/DMG/updater payload equality passed.

| Payload | SHA-256 |
| --- | --- |
| DMG | `e9338caca71afe102585e3646cdd2eee4a660c35c0311d8d72f7f5055daa8ca6` |
| Executable | `64bb4095539ddd510e6bc992362caf6be7dd65f7dd2b186bcbe2516467f9b98f` |
| Updater archive | `1487efff7361cba91674763a83307766a03e73ad89578e0eedc77bfab60e63cb` |

## Actual updater proof and limits

A disposable beta.4 build used the same native updater, public key, version
comparison and restart guards, with only a versioned staging endpoint, test name
and synthetic UI fixtures. The production beta.5 payload installed through the
native updater and restarted successfully; its hash/version and retained
synthetic transcript were verified. It was not installed over the owner's app.

| Check | Evidence/result |
| --- | --- |
| Failed download | Interrupted TLS transfer failed visibly, kept beta.4 intact, retry succeeded |
| Later | Declining restart left the running beta.4 test copy intact |
| Pending question | Visible question card; native installation refused |
| Pending approval | Visible Allow/Deny card; native installation refused without executing it |
| Cross-window work | Restart from idle second window refused while first window remained Working |
| Scheduled-work preparation | Initial tool connection failed; a fresh isolated retry held preparation with the session otherwise idle, and native installation refused |
| Owner profile and pairing | Full existing chats/groups/Monos/settings/phone confirmation remains pending |

The fixture exercised synthetic application state, not real provider work or
physical phone pairing. Seventeen targeted updater/configuration tests also
passed. These checks do not replace the remaining owner-profile/pairing verification.
The test harness is local-only and is not included in this release.

`COMPANION_MAC_UPDATE_VERIFIED` remains **false**. The global
`companion-updates-beta/latest.json` feed is **not published**. The versioned
candidate manifest does not activate discovery in the installed beta.4 app.
Do not advertise automatic updates as finished or promote the feed until all
required checks in [release setup](release-setup.md) pass. After validation and
promotion, the intended owner flow is **Check for updates → Download → Later or
Restart to update**, with a fresh host-wide idle check. No owner restart was
performed by this release task.
