# Release setup preflight

The intended normal-user path is a direct signed Mac download with verified
in-app updates, plus TestFlight for iPhone beta delivery. The iPhone portion is
now live for internal Owner testing: build **0.1.1 (1003)** is valid in App Store
Connect and in beta testing. The public external beta and signed Mac download are
still pending, so do not publish an installer or invitation yet. The eventual
normal-user path does not require a public App Store listing, a terminal, Xcode, or
USB. See [Updates and distribution](updates-and-distribution.md)
for the broader delivery and rollback plan.

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
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` | App Store Connect API credentials used by Tauri notarization. |

The endpoint must be HTTPS, use the explicitly declared companion host, and may
not reference the upstream `hardbeat920/monocode` releases. The checked-in
companion config deliberately keeps updater endpoints disabled until a protected
release workflow writes a production config with the public key and endpoint.
Do not enable an updater in a local development build.

`APPLE_SIGNING_IDENTITY` must name a **Developer ID Application** certificate;
an Apple Distribution certificate is for the iPhone target. Tauri requires a
separate updater signature in addition to Apple signing and notarization. Store
the updater private key and its recovery copy outside source control.

## TestFlight iPhone beta

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
the last uploaded build (1003 at this milestone). The workflow writes it directly
to `bundle.iOS.bundleVersion`, not the CLI flag that appends a number to the
marketing version.

For a new release, leave **upload** unchecked for the first packaging check. The
workflow builds the UI, uses automatic signing with the `app-store-connect` export
method, and verifies the packaged bundle ID, marketing/build versions, team,
signature and distribution profile. It rejects development/ad hoc provisioning. A
verified IPA is retained as a 14-day workflow artifact. Selecting **upload** then
submits it to Apple for processing; it does not submit a public App Store release
or automatically invite testers. No signing key is retained in artifacts; the
temporary key is removed on exit.

Apple processing for build **1003** is complete: App Store Connect reports the
build as **VALID** and **IN_BETA_TESTING** in the internal Owner testing group.
The owner-only encryption declaration has been submitted. An external **Community
beta** group exists with its public invitation disabled. The English beta
description and build testing notes are saved. Public feedback/support contact,
privacy URL, Apple's private review contact, and external beta review still
need completion before inviting community testers. Do not assert that the custom
Iroh encrypted transport is exempt without checking Apple's questionnaire. Confirm
an in-place TestFlight install keeps pairing before opening external testing.

The workflow selects Xcode 26.3 explicitly, verifies iOS SDK 26 or newer in the
packaged app, and generates opaque PNG icons without alpha channels. These guard
against the SDK and large-icon rejections encountered on the first signed
candidate. Candidate 1003 passed CI, uploaded successfully, and completed Apple
processing. Mac release CI, notarized Mac packaging, and safe installation/restart
handling are pending; the `mac` preflight alone does not implement automatic
updates.

## External TestFlight handoff

The internal Owner group remains separate from Community beta. Do not add ordinary
testers to the Apple developer team to bypass external review. Prepare the beta
description, public feedback contact, privacy/support links, and Apple's private
review contact fields. A build must be approved for external beta testing before
the community can use it.

The reviewer needs a usable companion-enabled Mac and pairing instructions, or a
clearly labeled sample mode exposed in the submitted app. Build 1003's preview is
a developer URL option, not an accessible reviewer onboarding flow. Do not claim
that review can use a hidden preview button or supply the maintainer's real Mac,
provider credentials, or short-lived QR invitation. Complete the signed Mac
download/reviewer path before submitting a beta that depends on it.

The first encryption declaration covered owner testing without France
distribution. Confirm intended external availability and the applicable Apple
questionnaire/documentation before enabling an unrestricted public invitation.
TestFlight's device/OS eligibility criteria are not a country restriction.

Once review, the compatible Mac download and owner upgrade check pass, add the
approved build to Community beta, enable a bounded public invitation and put its
actual TestFlight URL in the README. Keep source-build steps under contributor
instructions. Never substitute a workflow IPA download for the invitation.
