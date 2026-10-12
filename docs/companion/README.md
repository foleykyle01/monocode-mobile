# MonoCode Companion notes

The companion is an experimental iPhone client for sessions already owned by an isolated MonoCode desktop build. The Mac remains the session and provider owner. The iPhone is a paired remote control; it does not receive provider credentials or a copy of the desktop database.

- [Setup, pairing, capabilities, and current validation](../../companion/README.md)
- [Source and device validation scope](validation-public.md)
- [Product and design record](design-notes.md)
- [Read-only Inbox and Changes](inbox-and-changes.md)
- [Mono details and navigation polish](mono-details.md)

The ordinary MonoCode release is deliberately outside this experiment. The companion desktop build has a distinct identity and data directory so it can be tested without replacing a daily-use installation.

## Repository boundaries

The repository retains MonoCode's upstream [MIT license](../../LICENSE). It includes the companion source and documentation only. Local desktop app data, QR invitations, host descriptors, device credentials, and signing files must remain outside the working tree; generated Xcode projects, build bundles, and dependency/build caches are ignored.

Research informed by the Superset project was kept as design evidence only. No Superset checkout or source is included here.
