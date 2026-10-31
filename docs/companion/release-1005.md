# TestFlight 0.1.1 (1005) — 14 October 2026

> Historical release record. Current availability is stated in
> [Updates and distribution](updates-and-distribution.md); this record does not
> describe the current TestFlight or Mac release state.

Apple processed this build as **VALID** and it is **IN_BETA_TESTING** in the
existing **Owner testing** group. Testing notes were saved and read back. The
verified unchanged-encryption declaration from 1004 was reused; no new encryption
implementation or native/protocol change is part of this release.

## Source and checks

- [PR #13](https://github.com/foleykyle01/monocode-mobile/pull/13), merge
  `3e33ffbdecffa40d006a6ec907604163e1729ead`, contains linked conversations,
  attention/lifecycle/follow-up sending and the shared interface polish.
- [PR CI](https://github.com/foleykyle01/monocode-mobile/actions/runs/38625646350)
  and [main CI](https://github.com/foleykyle01/monocode-mobile/actions/runs/38626184548)
  passed. Parent review covered the source and visual evidence; local validation
  passed 299 focused tests and 29 browser checks, with one explicit WebKit
  reduced-transparency emulation skip. Public builds/typechecks passed.
- [Protected TestFlight workflow](https://github.com/foleykyle01/monocode-mobile/actions/runs/38626256023)
  passed with `upload=true`: phone validation, archive, identity/version/signing/
  provisioning/SDK verification, upload and ephemeral-key cleanup succeeded.
- Apple API verified build 1005 was unused before dispatch, then verified its
  processed state, notes, compliance metadata and Owner-only group assignment.
  No no-mistakes gate was initialized or claimed; the established review and CI
  release path was used.

## Compatibility and availability

The phone keeps Send beside Stop and uses the host's existing queue/steering path
when the host advertises that capability. Linked cards, truthful lifecycle and
attention navigation require a matching host. **Published Mac beta.2 does not
contain these host changes.** Updating only the phone cannot enable them.

A matching Apple Silicon Mac package was built locally from the exact released
source tree with the existing companion build command. It is ad-hoc signed,
source version 0.13.0, and not notarized or publicly released. Strict signature
and ZIP-integrity checks passed. Updater endpoints remain empty. Installing or
restarting the running app and changing live profiles were not part of this
release; a deliberate manual handoff remains necessary.

Build **1004** remains **WAITING_FOR_BETA_REVIEW** in Community beta. Its existing
public invitation and 100-person cap are unchanged. Build 1005 was not added to
Community beta or submitted for external review or a public App Store release.
Native notifications remain disabled.

## Physical verification still required

Verify retained pairing/drafts and real provider queue/steer delivery with both
matching builds; rapid sends, approval/question resolution and Stop/failure
outcomes; return navigation and keyboard geometry; suspension/reconnection and
relaunch; OS reduced motion/transparency and physical-device performance.

Lighthouse results remain separate from physical performance: simulated phone
63/100/96/91; unthrottled local phone and desktop 100/100/96/91. The native-app SEO
metadata exception and fixture favicon finding remain documented in the local
evidence report. TestFlight availability is verified; installation on the owner's
iPhone has not been verified.
