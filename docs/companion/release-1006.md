# TestFlight 0.1.1 (1006) — 14 October 2026

> Historical release record. Current availability is stated in
> [Updates and distribution](updates-and-distribution.md); this record does not
> describe the current TestFlight or Mac release state.

Apple processed this build as **VALID** and it is **IN_BETA_TESTING** in the
existing **Owner testing** group only. Testing notes were saved and read back.
The verified `usesNonExemptEncryption=false` declaration from 1005 was reused
for unchanged encryption; this release introduces no encryption/native protocol
change or new classification.

## Changes and compatibility

Home Mono cards now reflect eligible child work consistently: Needs you, then
Working, then Idle. Working phone cards show a compact wheel that stops animating
under Reduced Motion while the Working label remains visible. Parent-only
approval/send controls and minimal home-card content remain unchanged.

The source includes the reviewed Mac prerequisites: shared child-status circles
across sidebar, floating and background owners, plus a guarded Claude-only model
session restart. Restart preserves conversation and Mono state and is unavailable
during work, pending input, handoff or queued follow-ups. Existing linked cards,
Back position, drafts, simultaneous Send/Stop and queue/steering remain intact.

Correct aggregate status requires the matching **MonoCode Dev 1.0.0-beta.4**
host; the wheel requires phone build 1006. Phone 1005 can display aggregate labels
with that host but has no wheel. The public beta.2 Mac download lacks these host
capabilities. Updating only the phone cannot add them.

## Source and verification

- [PR #15](https://github.com/foleykyle01/monocode-mobile/pull/15), merge
  `5e309c7d0840f01773d30c66e06118ad88bec1c7`, publishes all 37 reviewed files.
  Reviewed HEAD `2a7a8e13773edddc20ff697507c4a72ed67058ef` has the exact same
  source tree as that merge.
- [PR CI](https://github.com/foleykyle01/monocode-mobile/actions/runs/38639312953)
  and [main CI](https://github.com/foleykyle01/monocode-mobile/actions/runs/38640328435)
  passed. Parent review covered implementation, screenshots and browser evidence:
  74 shared/bridge tests, 14 phone navigation tests, 6 Chromium/WebKit checks,
  desktop/phone typechecks and builds, plus two direct Reduced Motion browser
  assertions. Earlier integrated Mac controls passed 135 focused tests.
- [Protected TestFlight workflow](https://github.com/foleykyle01/monocode-mobile/actions/runs/38640328852)
  passed with `upload=true`: phone validation, archive, packaged identity,
  version, signing, provisioning and SDK verification, upload, and ephemeral-key
  cleanup succeeded. Apple confirmed build 1006 was unused before dispatch.
- Apple API readback verified VALID, IN_BETA_TESTING, exact notes and Owner-only
  assignment. The established parent-review/repository-checks/CI path was used;
  no no-mistakes pipeline was initialized or claimed.

## Matching local Mac handoff

An Apple Silicon beta.4 app and DMG were built from the exact reviewed release
tree, Developer ID signed, Apple notarized and stapled. Strict signature,
Gatekeeper, identity/version/architecture, updater minisign and complete
built-app/DMG/updater payload equality checks passed. The safe local shortcut
pins the DMG and executable hashes, mounts the verified image read-only, refuses
while the app runs, and preserves verified profile backups and swap rollback.
Syntax, four refusal fixtures and a real live-app refusal check passed without
changing the installed beta.3 executable, process or backup list.

This installer is a **local owner handoff**, not a new public Mac download. It
was not installed during release preparation. The automatic update feed remains
off. Both the source tree and bundle identity are preserved; no live profile was
migrated or app restarted.

Build **1004** remains **WAITING_FOR_BETA_REVIEW** in Community beta. Its public
invitation and 100-person cap are unchanged. Build 1006 was not assigned externally
or submitted for public App Store release. Native notifications remain disabled.

## Remaining physical checks

Install beta.4 only after current work finishes and the app is quit. Update the
phone through TestFlight. Verify pairing, drafts/Back position, real queued or
steered sends and separate Stop, child Working/Needs you/Idle with an idle parent,
Reduced Motion wheel behavior, and guarded Claude restart. Device installation,
keyboard geometry, suspension/reconnection and physical performance are not
established by CI or Apple availability.
