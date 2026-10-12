# MonoCode Companion iOS shell

This directory contains the isolated Tauri iOS shell for the MonoCode Companion. It uses the companion UI from `../ui` and has its own application identity (`dev.monocode.companion`) so it cannot replace or share the installed MonoCode desktop application.

## Prerequisites

- Node.js and the repository's installed dependencies
- Rust with the `aarch64-apple-ios` and `aarch64-apple-ios-sim` targets
- Xcode with an iOS SDK and simulator runtime

## Build and run

From `monocode/`, install dependencies and Rust's iOS targets once:

```sh
npm ci
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

Set `APPLE_DEVELOPMENT_TEAM` to your signing team ID only for a physical device build. Then initialize the local Apple project and build:

```sh
npm run companion:ios -- init --ci --skip-targets-install
npm run companion:ios
```

The default command builds the UI and a signed debug archive. Initialize through the npm wrapper so generated Xcode hooks use the mobile package script. Native Iroh supplies authenticated networking and iOS Keychain holds the device identity. See [pairing and validation](../README.md).

For an unsigned simulator build:

```sh
npm run companion:ios -- build --debug --target aarch64-sim --no-sign
```

The generated Xcode project is under `src-tauri/gen/apple/` and is intentionally local build output. Re-run `init` after Tauri/iOS configuration changes; do not commit it, its derived data, archives, signing files, or installed apps. The build wrapper regenerates the iOS AppIcon from `src-tauri/icons/icon.png` and refreshes the generated asset catalog.
