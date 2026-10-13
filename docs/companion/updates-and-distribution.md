# Updates and distribution

Status: proposed release design, October 13, 2026. Automatic distribution is not
enabled yet. The current public milestone is Companion **0.1.1 source preview**,
with desktop base **MonoCode 0.13.0**. A public GitHub repository is not itself a
production installer or an iPhone distribution channel.

## 1. The user experience

| Stage | Mac | iPhone |
| --- | --- | --- |
| First install | Download a signed, notarized DMG; drag the app to Applications | Join our TestFlight beta and tap Install; later install from the App Store |
| Connect | Settings → Connections → Phone companion → Show QR code | Scan once; pairing survives normal updates |
| Later updates | Check automatically, download a verified update, then offer Restart to update when work is safe | TestFlight/App Store manages updates according to the user's settings |
| Recovery | Keep the current app on download/signature failure; offer Retry | Reconnect to the same Mac after returning to the app |

No terminal, Xcode, USB cable or separate VPN app in the community install flow.
The Mac must remain open and awake to run agents. Updating an app cannot make a
sleeping/offline Mac reachable.

Automatic means discovery and delivery, not forcibly interrupting agents. The Mac
must not relaunch while an agent, habit, tool, approval or question is active.
Start with a user-confirmed restart after a fresh idle check; offer Later. An
eventual "install when idle" mode needs an atomic host-wide admission gate so a
scheduled run cannot start between the idle check and relaunch. Never auto-replay
an uncertain phone command to complete an update.

## 2. Mac release channel

Reuse the existing Tauri updater and Settings update UI. Configure only a
fork-owned HTTPS feed, public verification key and release URLs. The upstream
MonoCode feed must never update a companion-enabled installation.

Proposed hosting: signed artifacts and immutable version manifests in GitHub
Releases, with a small static HTTPS `stable/latest.json` and `beta/latest.json`
pointer on an owned update host. Decide that host before shipping the first
updater-enabled build; do not point production at a placeholder or the upstream
domain. A manifest contains the fork version, notes, date and per-architecture
artifact URL/signature. Publish artifacts first, validate downloads, then promote
the channel pointer. Never include a private GitHub token in the application.

Use Developer ID Application signing, hardened runtime and Apple notarization
for the Mac app. Tauri's separate updater signature verifies update artifacts;
it does not replace Apple signing/notarization. Keep private keys in a protected
release environment with an offline recovery copy, never source control or logs.
Reject missing signing configuration in release CI rather than building unsigned
fallbacks. Invalid signatures leave the installed application unchanged.

Check at launch, on foreground after a cooldown, and periodically while awake;
back off on errors, coalesce simultaneous checks and expose Check for updates.
Download can happen during work. Installation/relaunch follows the safe boundary
above, including work in every window. Re-read the active version after restart.

Preserve desktop identity `com.monocode.companion-spike` for existing users. Names
and icons can change without silently changing the data directory. Beta and
stable initially replace each other using that identity; they are not concurrent
installs. A separate development identity would require a separate migration
design. Preserve Keychain identities, groups, chats, Monos and habits. Back up
before schema migrations; a rollback never blindly restores an old database over
newly written sessions.

Use a fork-owned, monotonically increasing desktop version once binaries ship;
record the upstream base separately in About/release notes. The first updater
bootstrap must be newer than installed 0.13.0 (proposed `1.0.0-beta.1`). Do not
append semver build metadata as the only version increment. Existing Dev builds
have no feed, so one final drag-and-drop install is required to bootstrap updates.

## 3. iPhone releases

Start with TestFlight; move to the App Store after the beta exit checks. Users can
enable automatic TestFlight updates. External beta distribution requires Apple's
review; each TestFlight build expires after 90 days, so it is not permanent
production distribution. App Store automatic updates are enabled by default but
remain under user/iOS control; delivery is not instantaneous or a forced push.

Use `dev.monocode.companion` if it is registered and available under the chosen
Apple team. Verify that entitlement/App ID ownership before release. Keep the
same team, bundle ID and Keychain access group so identity and pending-command
records survive updates. A TestFlight install over today's development build
must be checked on the actual device; do not tell users to uninstall/re-pair.

Marketing version starts at 0.1.1; every uploaded archive needs a unique,
increasing build number. CI builds the embedded web UI and native shell together,
signs an App Store distribution archive, and uploads it using scoped App Store
Connect credentials. An IPA attached to GitHub is not an ordinary iPhone install
method. Do not use a custom downloaded-code updater to bypass Apple's channels.

Phone and Mac releases will arrive at different times. Keep capability gating and
protocol compatibility for at least the current and preceding supported pair.
When a host lacks a feature, show a targeted update message, not Unauthorized or
a pairing reset. Existing host identity and revocation remain authoritative.

## 4. Release pipeline and upstream maintenance

1. Check the latest upstream stable tag, compare its pinned commit with the fork,
   and integrate in a review branch. Unreleased upstream main is not the public
   default. On October 13, latest stable is still v0.13.0, already integrated;
   origin/main has 33 later commits. No upstream merge was needed this pass.
2. Run bounded bridge/UI/native checks, schema/identity checks and connection
   lifecycle tests. Review the public export for credentials, private data and
   broken links. Public source receives only reviewed exported history.
3. Release CI on a protected tag builds the signed/notarized Mac DMG and updater
   archive and the signed iOS archive. Secrets are unavailable to untrusted PRs.
   Upload immutable artifacts with checksums; publish beta channels first.
4. Verify an installed previous build updates with its profile/pairing intact,
   then promote the tested Mac artifact to stable and submit the corresponding
   iPhone build for App Store review. Preserve older compatible artifacts.
5. Record supported Mac/phone versions and exact upstream base. Monitor failed
   checks and connection errors without recording tickets, device secrets or
   transcripts. Withdraw a broken feed entry and ship a higher-version fix;
   rollback compatibility must be proven before restoring older binaries.

## 5. Implementation gates and acceptance

Current foundations: Tauri updater is present; companion endpoints are disabled;
the manual fallback now points to this fork. Phone version metadata is 0.1.1.
Only an Apple Development identity was found locally during this review; that
does not prove whether distribution certificates exist in the Apple account.

Still needed before normal-user delivery: Developer ID/notarization setup,
Tauri signing key and owned feed location, App Store Connect app and distribution
credentials, privacy/support metadata, a protected release workflow, idle-safe
desktop update handling, and the one-time bootstrap installers. No credentials
were generated or uploaded and no automatic feed was enabled by this spec.

Release acceptance must cover interrupted/corrupt downloads, wrong signatures,
beta/stable separation, active-agent restart deferral, multi-window/habit races,
pairing/profile survival, previous-version compatibility and a usable rollback.
Connection checks must cover phone lock/resume, Wi-Fi ↔ cellular, Mac sleep/wake,
Mac relaunch and revoked devices. Mac relaunch currently retains pairing but
requires enabling Remote access again; document this until an explicit opt-in
"restore remote access on launch" preference is separately implemented and tested.
No hidden login helper or automatic security-setting change is part of this pass.

Authoritative references: [Tauri updater](https://v2.tauri.app/plugin/updater/),
[Mac signing and notarization](https://v2.tauri.app/distribute/sign/macos/),
[Apple TestFlight](https://developer.apple.com/testflight/),
[TestFlight installation and automatic updates](https://beta.itunes.apple.com/),
[TestFlight build lifetime](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/),
and [App Store updates](https://support.apple.com/en-ie/102629).
