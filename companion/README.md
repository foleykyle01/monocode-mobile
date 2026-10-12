# MonoCode Mobile Companion

An experimental native iPhone client for sessions running in **MonoCode Dev**, the isolated companion-enabled Mac build. The ordinary upstream app cannot host this client. Agents, provider credentials, project files, and authoritative conversation history remain on the Mac.

The path is **iPhone React UI → native Keychain + Iroh → encrypted direct/relay connection → embedded Mac host → authenticated loopback bridge → existing desktop session owner**.

This implementation is derived from [MonoCode](https://github.com/hardbeat920/monocode), currently incorporating upstream `v0.13.0`, and retains the [MIT license](../LICENSE) and [notices](../NOTICE). It is an independent prototype, not an official mobile release. There is no App Store or TestFlight distribution.

## Build requirements

Use a Mac with Node.js 20+, stable Rust, Xcode with an iOS SDK/runtime, and Apple's command-line tools. Native archives have been built with Xcode 26.4; older toolchain compatibility is not established. Physical installation requires your own Apple development signing configuration.

From the repository root:

```sh
npm ci
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run companion:ios -- init --ci --skip-targets-install
```

Initialization generates `companion/mobile/src-tauri/gen/apple/`, which stays outside Git. Repeat it after Tauri/iOS configuration changes. Keep signing files, archives, installed bundles, and app data outside the repository. The Rust locks pin Iroh 1.3.0 and libc 0.2.183 to retain current Darwin/netwatch build compatibility.

## Build the connected apps

Build the Mac host:

```sh
npm run companion:desktop
```

Open `target/release/bundle/macos/MonoCode Dev.app`. It uses the separate `com.monocode.companion-spike` identity and data directory. This build does not migrate a daily profile. Provider binaries and login state can still be shared with the daily installation; the isolation is not an agent sandbox. The companion build disables MonoCode-managed provider updates and the upstream application updater feed.

For a physical iPhone, set your signing team in the shell and build:

```sh
APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID npm run companion:ios
```

The wrapper builds the UI, regenerates the AppIcon, and creates a signed debug archive under the generated Apple tree. Install through Xcode or Apple's CoreDevice tools onto a trusted device. The phone identity is `dev.monocode.companion`; the build reports its archive path.

For an unsigned simulator build of the connected client:

```sh
npm run companion:ios -- build --debug --target aarch64-sim --no-sign
```

## Pair and connect

1. In the Mac app, open **Settings → Connections → Phone companion**, enable **Remote access**, and choose **Show QR code**.
2. In the iPhone app, choose **Scan QR ticket**, scan the code, and tap **Connect to Mac**. The app requests camera access; paste is also available.
3. Keep MonoCode Dev open and the Mac awake. Remote access defaults off after each Mac launch; existing pairing is retained.

Invitations are random, expire after five minutes, and enroll one new device. Replacing or cancelling an invitation invalidates it. Treat the invitation as a temporary enrollment credential; keep active QR codes out of published screenshots.

The Mac lists paired devices and supports revocation. Revocation blocks subsequent commands; accepted work may finish. **Forget Mac** deletes phone credentials without revoking the Mac's device record. Review unconfirmed commands before forgetting or pairing again.

Iroh supplies authenticated, encrypted direct connections with public relay fallback, without a separate VPN app or manual router setup. Relay operators can see connection metadata; shared infrastructure has availability and rate-limit constraints. See [Iroh documentation](https://docs.rs/iroh/1.3.0/iroh/).

## Preview safely

The native Mac preview uses simulated workspace data and contacts no agents:

```sh
npm run companion:preview
```

Open the generated **MonoCode Phone Preview.app**. It has a separate identity and sample connection/settings choices, including **Preview connection setup**.

To build the same sample UI in an iPhone Simulator:

```sh
npm run companion:ios -- build --debug --target aarch64-sim --no-sign --config '{"app":{"windows":[{"label":"main","title":"MonoCode Companion","url":"index.html?demo=1","width":390,"height":844,"resizable":true}]}}'
```

Install `companion/mobile/src-tauri/gen/apple/build/arm64-sim/MonoCode Companion.app` into an iPhone simulator. Sample sending, Inbox, approvals, and pairing are simulated and contact no live providers. Omit that sample configuration for a connected phone build.

## Capabilities and security boundaries

Browse Monos and the Mac's group → project → session hierarchy, read paged transcripts, send follow-ups, create blank sessions, select advertised models/access modes, answer structured agent questions (choices, multiple selections, custom text, and Skip), Allow/Deny supported actions, and Stop a running turn. Inbox, Changes/diffs, and Mono details are read-only. Appearance follows the Mac where it has a phone equivalent; phone Light/Dark overrides do not alter the Mac.

Chat activity uses a collapsible connected tool tree, including the latest 20 steps of a delegated run. Completed sessions show the desktop checkpoint's **Changed files** summary and individual recorded diffs, independently of workspace Git changes. Review is read-only: Keep, Undo, staging, and committing remain on the Mac. Lists show at most 200 files; unavailable, binary, or oversized diffs direct you to the Mac.

Question answers use the same desktop provider handler and durable exact-request retry mechanism as approvals. Interacting with a timed question asks the Mac to keep it open. Stale questions, unsupported choices, and truncated question payloads cannot be answered. Both the Mac host and phone need updated builds for these commands; older hosts continue showing their supported features.

Eligible sessions exclude remote projects, habit runs, ephemeral/Inbox-ask sessions, orchestration-controlled sessions, and sessions undergoing removal or workspace changes. Unopened Monos require initialization on the Mac. Advertised capabilities disable unsupported features on older hosts.

The host and loopback bridge allowlist companion actions, with no arbitrary native-command or direct database-write interface. A paired phone can still instruct agents and select available access modes, including full access: its authority depends on the Mac's agent permissions. Habit approvals and truncated action previews require Mac review.

Phone identity and unconfirmed commands use Apple Keychain with synchronization disabled and WhenUnlockedThisDeviceOnly protection. The identity stays in native code. Mac identity/descriptor files are restricted to the owning user. There is no separate biometric app lock or independent security audit.

## Recovery and limits

The app polls bounded snapshots while visible and refreshes/rebuilds transport after foregrounding or regained connectivity. Reconnect retains pairing and does not automatically replay pending commands.

Mutations are saved before dispatch with their exact host, request ID, action, and input. The Mac deduplicates matching requests within its renderer epoch and rejects changed input or stale state. A timeout may mean the command ran but its receipt was lost: review the conversation or explicitly retry the same command. Desktop receipts are memory-only and limited to 512 commands per epoch; a restart may require manual outcome review.

Push notifications, event replay, full desktop feature parity, general Android support, production distribution, and dedicated relay operations remain unfinished. Physical keyboard/safe-area behavior, accessibility, long suspension, and interrupted-command/network-handoff races need broader testing.

See [validation scope](../docs/companion/validation-public.md), [design notes](../docs/companion/design-notes.md), [Inbox and Changes](../docs/companion/inbox-and-changes.md), and [Mono details](../docs/companion/mono-details.md). The optional `npm run companion:host` CLI is diagnostic; an exclusive lock prevents it from sharing the embedded host's identity concurrently.
