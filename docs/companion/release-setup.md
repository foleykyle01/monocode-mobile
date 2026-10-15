# Release setup preflight

The intended normal-user path is a direct signed Mac download with verified
in-app updates, plus TestFlight for iPhone beta delivery. The iPhone portion is
now live for internal Owner testing: build **0.1.1 (1006)** is VALID in App Store
Connect and IN_BETA_TESTING in the existing Owner testing group. Its testing notes
are saved. Build 1004 remains in Community beta, waiting for external review;
the existing public invitation is configured with a 100-person cap. The signed
Mac beta.5 download is now public and includes the current host features plus
combined Mono status/unread badges. The owner has beta.4 installed with the
dedicated fork feed and verification key embedded. Feed activation remains
disabled while the full real-update safety/profile gate is incomplete; see the
[beta.5 updater record](release-mac-beta5.md). The
normal-user path does not require a public App Store listing, a terminal, Xcode, or
USB. See [Updates and distribution](updates-and-distribution.md)
for the broader delivery and rollback plan.

The [1006 release record](release-1006.md) links source/CI/upload evidence and
documents compatibility and remaining physical-device verification.

Before an expensive signed archive or upload, run one of these in the protected
release environment:

```sh
node scripts/companion-release-preflight.mjs mac
node scripts/companion-release-preflight.mjs testflight
```

The preflight is fail-closed. It only prints missing or invalid variable names;
it never prints a key, certificate, password, endpoint value, or provisioning
profile. It does not generate credentials, sign, upload, modify a feed, or turn
on the updater. A passing result is a readiness check, not a release.

## Mac direct distribution

The `mac` target requires these protected release variables:

| Variable | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri private key used to sign update artifacts. |
| `TAURI_UPDATER_PUBKEY` | Public key that the release config embeds in the Mac app. |
| `TAURI_UPDATER_ENDPOINT` | HTTPS feed endpoint used in the release config. |
| `MONOCODE_COMPANION_UPDATE_HOST` | Expected hostname for that endpoint; it must match exactly. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Exported Developer ID certificate and its password, imported by Tauri into the CI keychain. |
| `APPLE_SIGNING_IDENTITY` | Must begin with `Developer ID Application:`. |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | App Store Connect API credentials; the workflow writes the key to a temporary private file for notarization. |

The endpoint must be HTTPS, use the explicitly declared companion host, and may
not reference the upstream `hardbeat920/monocode` releases. The checked-in
companion config deliberately keeps updater endpoints disabled until a protected
release workflow writes a production config with the public key and endpoint.
Do not enable an updater in a local development build.

`APPLE_SIGNING_IDENTITY` must name a **Developer ID Application** certificate;
an Apple Distribution certificate is for the iPhone target. Tauri requires a
separate updater signature in addition to Apple signing and notarization. Store
the updater private key and its recovery copy outside source control.

### Mac release workflow

The **Companion Mac release** workflow builds only public `main` and uses the
protected `companion-mac-release` environment. It requires maintainer review and
the signing secrets above, plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the
update key is password-protected. The initial installer targets **Apple Silicon**;
Intel packages are not offered by this workflow.

Use a fork beta version such as `1.0.0-beta.1`. The generated release overlay keeps
the existing `com.monocode.companion-spike` identifier, app name and data location;
normal source builds keep their updater disabled. It embeds only the public
verification key and the dedicated GitHub beta feed.

1. **prepare** builds, signs, notarizes and verifies the DMG/update archive, then
   retains them as workflow artifacts for review. It publishes nothing.
2. **publish-download** performs those checks and publishes a new immutable
   `companion-mac-v<version>` prerelease. It refuses to replace an existing release.
   It does not enable the update feed.
3. **promote-feed** points the beta feed at an already published version. This
   phase requires protected environment variable `COMPANION_MAC_UPDATE_VERIFIED`
   to be exactly `true`, set only after the real bootstrap/upgrade checks below.

Package verification checks the app identifier/version, Apple Silicon architecture,
Developer ID team, embedded public key/feed, notarization and the signed app inside
the DMG. The workflow independently verifies the updater archive's Minisign
signature and checks anonymous download URLs before changing the feed. Private
keys are excluded from uploaded artifacts.

Before enabling feed promotion, test a backed-up existing Dev profile with the
bootstrap, confirm chats/groups/Monos/settings and phone pairing, then install a
higher signed version through the updater. Test active work in another window,
pending questions/approvals, scheduled work, a cancelled restart and a failed
download. Keep the gate off if any of these checks fail.

### Installing the first signed Mac build

Download the DMG and drag **MonoCode Dev** into Applications. Existing Dev users
must first finish active work and quit the app, then replace their existing copy
in its current location. If that copy lives in your personal `Applications`
folder, replace it there rather than keeping two copies. Reopen Dev and verify
your workspace and phone connection. Do not delete app data or re-import an older
MonoCode profile as part of this update. Remote access may need to be re-enabled
after relaunch; the pairing remains stored.

## TestFlight iPhone beta

Builds 1004 through 1006 keep `PHONE_NOTIFICATIONS_ENABLED` false in
`companion/ui/features.ts`. Notification settings, polling, permission requests,
and tap routing remain inactive. The native push plugin and relay integration
are not included in this release. Enable the flag only with the native integration
and after physical TestFlight notification delivery has been verified.

The `testflight` target uses Tauri/Xcode automatic signing:

| Variable | Purpose |
| --- | --- |
| `APPLE_DEVELOPMENT_TEAM` | Ten-character Apple team ID injected into the iOS bundle configuration. |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | App Store Connect API issuer, key ID, and private-key content. |
| `IOS_BUILD_NUMBER` | Numeric iOS build value, such as `1001`; it has up to three numeric components (four digits, two digits, two digits), beginning with a positive component. |

Automatic signing owns the Apple Distribution certificate and App Store Connect
provisioning profile; the preflight intentionally does not require exported
`IOS_CERTIFICATE` or `IOS_MOBILE_PROVISION` values. The release job must use the
`app-store-connect` export method, not ad hoc `release-testing`.

The iPhone identifier is fixed at `dev.monocode.companion`; the Mac identifier is
fixed at `com.monocode.companion-spike`. The preflight rejects a changed identity
or disagreeing version metadata in the iOS Tauri config, Cargo manifest, and
mobile package manifest. Changing either identity is a migration decision, not a
release-time fix, because it can separate stored pairing and Keychain data.

Apple App Store Connect remains the final authority on build-number uniqueness.
The preflight verifies that `IOS_BUILD_NUMBER` is a valid numeric build value;
the release workflow must select a number that has not already been uploaded for
the current marketing version. Do not use a GitHub-hosted IPA or downloaded-code
updater as an iPhone distribution shortcut.

The variables and certificate distinctions follow Tauri's [macOS signing and notarization guide](https://v2.tauri.app/distribute/sign/macos/), [iOS signing guide](https://v2.tauri.app/distribute/sign/ios/), and [updater guide](https://v2.tauri.app/plugin/updater/).

## GitHub TestFlight workflow

The manual **Companion TestFlight** workflow builds only public `main`. Create the
`companion-testflight` GitHub environment, restrict its deployment branch to
`main`, and require a release reviewer before adding credentials. Store the three
`APPLE_API_*` secrets in that environment and `APPLE_DEVELOPMENT_TEAM` as an
environment variable. The API key must have the Apple permissions needed for
automatic provisioning and uploads; configure the least available role that
supports those operations. Do not put a signing key in repository variables.

Before setting `COMPANION_TESTFLIGHT_READY=true` in that environment, verify the
App Store Connect app record owns `dev.monocode.companion`, agreements are current,
and the account can distribute the app. Select an unused build number greater than
the last uploaded build (1006 at this milestone; check Apple before the next release). The workflow writes it directly
to `bundle.iOS.bundleVersion`, not the CLI flag that appends a number to the
marketing version.

For a new signing/release configuration, leave **upload** unchecked for its first
packaging check. For the established identity, an explicitly authorized upload can
use the same workflow's verification gate before upload, as build 1005 did. The
workflow builds the UI, uses automatic signing with the `app-store-connect` export
method, and verifies the packaged bundle ID, marketing/build versions, team,
signature and distribution profile. It rejects development/ad hoc provisioning. A
verified IPA is retained as a 14-day workflow artifact. Selecting **upload** then
submits it to Apple for processing; it does not submit a public App Store release
or automatically invite testers. No signing key is retained in artifacts; the
temporary key is removed on exit.

Apple processing and export compliance for build **1006** are complete; it is
**IN_BETA_TESTING** in Owner testing, with updated testing notes. Its physical
upgrade and reconnection check remains pending. Build 1004 remains
**WAITING_FOR_BETA_REVIEW** in Community beta. The existing public invitation is
enabled with a 100-person cap; availability to external testers still requires
Apple approval. Privacy URL, reviewer instructions, feedback email and private
review contact are configured. Build 1006 reused the verified 1005
`usesNonExemptEncryption=false` metadata for unchanged encryption; this is not a
new encryption classification or authorization for changed encryption.

The workflow selects Xcode 26.3 explicitly, verifies iOS SDK 26 or newer in the
packaged app, and generates opaque PNG icons without alpha channels. These guard
against the SDK and large-icon rejections encountered on the first signed
candidate. Candidate 1003 passed CI, uploaded successfully, and completed Apple
processing. Candidates 1004 through 1006 also passed signed upload and Apple processing.
Mac release CI and guarded installation/restart handling are implemented. The
signed/notarized Apple Silicon [1.0.0-beta.5 installer](https://github.com/foleykyle01/monocode-mobile/releases/tag/companion-mac-v1.0.0-beta.5)
is public. The owner has beta.4 installed. A disposable beta.4 fixture downloaded,
verified, installed and restarted into the exact beta.5 payload, retaining its
synthetic transcript. Pending question/approval and cross-window work refused
restart. The full scheduled-work and existing-profile/pairing checks remain
pending, so the Mac update feed stays disabled.

The [privacy page](privacy.md) and [reviewer setup instructions](beta-review.md)
are published and saved in App Store Connect. Build 1004 is waiting for external
review; this 1006 Owner release did not cancel or replace that submission or
change the Community invitation.

## External TestFlight handoff

The internal Owner group remains separate from Community beta. Do not add ordinary
testers to the Apple developer team to bypass external review. Prepare the beta
description, public feedback contact, privacy/support links, and Apple's private
review contact fields. A build must be approved for external beta testing before
the community can use it.

The reviewer needs a usable companion-enabled Mac and pairing instructions, or a
clearly labeled sample mode exposed in the submitted app. Build 1004's preview is
a developer URL option, not an accessible reviewer onboarding flow. Do not claim
that review can use a hidden preview button or supply the maintainer's real Mac,
provider credentials, or short-lived QR invitation. Complete the signed Mac
download/reviewer path before submitting a beta that depends on it.

The owner has configured the existing public invitation. The initial encryption
declaration was for owner testing; this release only reuses verified metadata for
the unchanged 1006 internal build. Any new encryption or legal questionnaire
requires its own review. TestFlight's device/OS eligibility criteria are not a
country restriction.

Once review, the compatible Mac download and owner upgrade check pass, add the
approved build to Community beta, retain the bounded public invitation and put its
actual TestFlight URL in the README. Keep source-build steps under contributor
instructions. Never substitute a workflow IPA download for the invitation.
