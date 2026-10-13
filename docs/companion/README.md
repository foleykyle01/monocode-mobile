# MonoCode Companion notes

The companion is an experimental iPhone client for sessions already owned by an isolated MonoCode desktop build. The Mac remains the session and provider owner. The iPhone is a paired remote control; it does not receive provider credentials or a copy of the desktop database. TestFlight build **0.1.1 (1004)** is currently available to the internal Owner testing group; external beta distribution is still pending.

- [Install, use, update, and troubleshoot the companion](../../README.md)
- [Distribution status and release approach](updates-and-distribution.md)
- [Setup, pairing, capabilities, and current validation](../../companion/README.md)
- [Source and device validation scope](validation-public.md)
- [Question replies, tool activity tree, and session diffs](chat-parity.md)
- [Product and design record](design-notes.md)
- [Read-only Inbox and Changes](inbox-and-changes.md)
- [Mono details and navigation polish](mono-details.md)

The ordinary MonoCode release is deliberately outside this experiment. The companion desktop build has a distinct identity and data directory so it can be tested without replacing a daily-use installation. Each tester needs a compatible companion Mac host, their own provider accounts, and their own pairing; the TestFlight app does not provide a shared remote host.

## Repository boundaries

The repository retains MonoCode's upstream [MIT license](../../LICENSE). It includes the companion source and documentation only. Local desktop app data, QR invitations, host descriptors, device credentials, and signing files must remain outside the working tree; generated Xcode projects, build bundles, and dependency/build caches are ignored.

Research informed by the Superset project was kept as design evidence only. No Superset checkout or source is included here.
