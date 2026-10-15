# Updates and distribution

Status: October 15, 2026. Companion **0.1.1 (1006)** is in internal Owner testing;
this Mac-only update makes no iPhone release changes. Signed/notarized Mac
**1.0.0-beta.5** is publicly downloadable, with desktop base **MonoCode 0.13.0**.
The owner has beta.4 installed. Automatic Mac delivery remains disabled pending
the complete upgrade safety/profile gate. See [beta.5 evidence and limits](release-mac-beta5.md).

## 1. The user experience

| Stage | Mac | iPhone |
| --- | --- | --- |
| First install | Download a signed, notarized DMG; drag the app to Applications | Current internal path: join the Owner TestFlight beta and tap Install |
| Connect | Settings → Connections → Phone companion → Show QR code | Scan once; pairing survives normal updates |
| Later updates | Check automatically, download a verified update, then offer Restart to update when work is safe | TestFlight manages updates according to the user's settings |
| Recovery | Keep the current app on download/signature failure; offer Retry | Reconnect to the same Mac after returning to the app |

No terminal, Xcode, USB cable or separate VPN app in the community install flow.
The Mac must remain open and awake to run agents. Updating an app cannot make a
sleeping/offline Mac reachable.

The eventual community download page will offer two distinct buttons: **Download for Mac**
links to the signed GitHub release DMG, and **Join the iPhone beta** links to the
public TestFlight invitation after external beta approval. Source archives remain
available separately for contributors. Do not present a GitHub IPA download as an
install button for ordinary iPhone users. Until the signed installers and approved
invitation exist, label the current release as an internal beta/source preview.

Each user installs the Mac host, uses their own provider accounts, and pairs their
phone to their own Mac. They do not need membership in our Apple developer team
or access to our GitHub release credentials. Never ship the maintainer's profile,
paired-device records, provider keys or personal workspaces in a release.

Automatic means discovery and delivery, not forcibly interrupting agents. The Mac
must not relaunch while an agent, habit, tool, approval or question is active.
Start with a user-confirmed restart after a fresh idle check; offer Later. An
eventual "install when idle" mode needs an atomic host-wide admission gate so a
scheduled run cannot start between the idle check and relaunch. Never auto-replay
an uncertain phone command to complete an update.

## 2. Mac release channel

The installed owner beta.4 embeds the dedicated fork beta endpoint and updater
verification key; its signature and executable identity were checked. It does
not need another manual bootstrap solely to acquire updater support. The guarded
updater and release workflow are implemented. A real disposable beta.4-to-beta.5
upgrade passed, but scheduled-work and full existing-profile/pairing verification
remain incomplete. The global feed is therefore still unpublished and gated off.
Users on older builds without an embedded fork feed still need a signed bootstrap.

Reuse the existing Tauri updater and Settings update UI. Configure only a
fork-owned HTTPS feed, public verification key and release URLs. The upstream
MonoCode feed must never update a companion-enabled installation.

Use this fork's public GitHub Releases for delivery; no additional user account
or paid update service is needed. The proposed beta feed is
`https://github.com/foleykyle01/monocode-mobile/releases/download/companion-updates-beta/latest.json`.
Reserve a separate `companion-updates-stable` tag for stable delivery. These feeds
are **not live**; the release overlay embeds the beta endpoint for bootstrap testing. Each pointer
contains the fork version, notes, date and per-architecture artifact URL/signature;
artifact URLs refer to immutable, versioned releases rather than the channel tag.
Publish and validate signed artifacts first, then replace the channel manifest.
Never include a private GitHub token in the application. Keep both channels outside
GitHub's generic `/releases/latest`, which may refer to an unrelated source preview.

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
record the upstream base separately in About/release notes. Current candidate
beta.5 is newer than installed beta.4. Do not append semver build metadata as the
only version increment. Only older Dev builds without the fork feed require a
manual bootstrap.

### Bootstrap and later delivery

1. Ship the first signed/notarized **MonoCode Dev** DMG with the existing bundle
   identifier, the fork feed, its public updater key and safe restart handling.
   Existing users quit Dev and replace only the app in its existing location.
   Do not delete the app's data folder, import the original MonoCode profile again,
   or revoke phone pairing. The owner already has this updater-capable bootstrap.
2. After the bootstrap and validated feed activation, checking for updates shows a version and release notes.
   Users can download during work, select Later, or choose Restart to update.
   TestFlight continues handling phone updates independently.
3. Release maintainers build from reviewed public source, validate signatures,
   notarization and anonymous download URLs, and promote the beta feed. The app
   discovers that manifest on its next check; publishing does not force a restart.
4. If a release fails, withdraw its feed entry and publish a corrected higher
   version. Keep previous artifacts. Replacing an app binary must never restore an
   old database over newer chats.

### Guarded restart implementation

`src-tauri/src/safe_updater.rs` owns signature-verified downloads and the final
installation. The webview no longer has permission to call the updater plugin's
install command directly. `src/app/model/updater.ts` offers a download followed
by **Restart to update / Later**; startup and six-hour checks discover releases.
Downloaded bytes stay in memory until installation or app exit.

Before installation, a native process-wide admission lock blocks new turns,
helpers, terminals and workspace construction. Every workspace must confirm
idle session state and flush its saved sessions. Missing/unresponsive owners,
pending questions/approvals, queued work, habit preparation, active terminals
and tracked worktree operations block restart. The lock stays through install
and relaunch and is released on failure. This does not pause or delete saved
habit schedules, and it cannot detect unrelated work in other Mac applications.

Before embedding a feed, tests must prove that an active second window blocks
installation, a new run cannot slip between the idle check and restart, unknown
owners fail closed, failed installs release the lock, and the real previous Dev
profile/Keychain pairing survives the bootstrap. A normal signed update must also
be exercised from the bootstrap to a higher version before advertising automatic
updates. No automatic updater has been enabled by this documentation change.

## 3. iPhone releases

Use TestFlight without a public App Store listing. Users can enable automatic
TestFlight updates. External beta distribution requires Apple's review; each
build expires after 90 days, so this channel needs ongoing beta maintenance and
is not permanent production distribution. Ship a replacement well before expiry.
Delivery remains under user/iOS control and is not an instantaneous forced push.

Current TestFlight state: build **1004** has completed Apple processing and export
compliance and is **Testing** in the internal Owner testing group. Notification
controls and delivery are disabled in this build. Physical upgrade/reconnection
validation for 1004 remains pending; the owner confirmed operation on 1003. The external **Community beta** group is prepared;
its public invitation is disabled and external review has not been submitted.
Community rollout follows the owner-only upgrade
check:

1. Owner TestFlight operation and reconnection are confirmed. Retain this check
   when changing app identity, storage or pairing behavior.
2. Complete beta description, feedback/support contact, review instructions and
   encryption compliance, then submit the candidate for external beta review.
3. After approval, enable a public invitation for a **Community beta** group with
   a modest initial tester limit. Publish that link alongside the compatible Mac
   download; only add builds whose phone/host compatibility checks pass.
4. Monitor feedback and ship replacement builds before the 90-day expiry. Explain
   the beta lifetime on the download page; TestFlight is not a permanent stable
   distribution channel. Apple permits up to 10,000 external testers per app.

The public invitation allows testers to join without developer-team access. It
does not grant access to anyone else's Mac. See Apple's
[external tester setup](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)
and [TestFlight overview](https://developer.apple.com/testflight/).

A public App Store release is not an accepted next step. Retain the working
native client while evaluating a PWA as a separate future option. That would
reuse the interface but needs a browser-compatible connection and credential
storage design; it is not a prerequisite for this TestFlight release.

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
   iPhone build for external TestFlight beta review. Preserve older compatible artifacts.
5. Record supported Mac/phone versions and exact upstream base. Monitor failed
   checks and connection errors without recording tickets, device secrets or
   transcripts. Withdraw a broken feed entry and ship a higher-version fix;
   rollback compatibility must be proven before restoring older binaries.

## 5. Implementation gates and acceptance

Current foundations: Tauri updater is present but companion endpoints are disabled;
the manual fallback now points to this fork. Phone version metadata is 0.1.1 and
build 1006 is available in internal TestFlight Owner testing. Apple Distribution and
Developer ID Application certificates were created in Xcode with the owner's
authorization. The development certificate is retained. Certificates alone do not
configure notarization, App Store Connect or CI access.

The TestFlight and Mac workflows have separate protected GitHub environments.
The Mac environment contains Developer ID/notarization credentials and a separate
Tauri signing key; both workflows run only on public `main` after review. Candidate
1003 passed iPhone processing and the owner confirmed operation/reconnection.
The Apple Silicon [1.0.0-beta.5 Mac installer](https://github.com/foleykyle01/monocode-mobile/releases/tag/companion-mac-v1.0.0-beta.5)
is signed, notarized, verified and public. The owner remains on beta.4.
Remaining Mac delivery checks are recorded in [the beta.5 record](release-mac-beta5.md);
the previous TestFlight external-review state is unchanged by this release. The Mac
feed remains disabled through `COMPANION_MAC_UPDATE_VERIFIED=false`. See the
[release setup checklist](release-setup.md) for the executable readiness check.

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
