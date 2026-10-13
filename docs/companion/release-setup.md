# Release setup preflight

The companion's normal-user path is a direct signed Mac download with verified
in-app updates, plus TestFlight for iPhone beta delivery. It intentionally does
not require a public App Store listing, a terminal, Xcode, or USB after the
initial iPhone install. See [Updates and distribution](updates-and-distribution.md)
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
and the account can distribute the app. Select an unused build number (first
candidate `1001`). The workflow writes it directly to `bundle.iOS.bundleVersion`,
not the CLI flag that appends a number to the marketing version.

The first run should leave **upload** unchecked. It builds the UI, uses automatic
signing with the `app-store-connect` export method, and verifies the packaged
bundle ID, marketing/build versions, team, signature and distribution profile.
It rejects development/ad hoc provisioning. A verified IPA is retained as a
14-day workflow artifact. Selecting **upload** submits it to Apple for processing;
it does not submit a public App Store release or automatically invite testers.
No signing key is retained in artifacts; the temporary key is removed on exit.

Apple processing, encryption-compliance answers, beta description/support
contact and any external beta review still need completion in App Store Connect.
Do not assert that the custom Iroh encrypted transport is exempt without checking
Apple's questionnaire. Add the owner's account to internal testing first; confirm
an in-place TestFlight install keeps pairing before opening external testing.

The workflow selects Xcode 26.3 explicitly, verifies iOS SDK 26 or newer in the
packaged app, and generates opaque PNG icons without alpha channels. These guard
against the SDK and large-icon rejections encountered on the first signed
candidate. Signing and package verification succeeded in CI; Apple rejected that
candidate's upload before TestFlight processing. A corrected candidate still needs
upload validation. Mac release CI and safe installation/restart handling are pending;
the `mac` preflight alone does not implement automatic updates.
