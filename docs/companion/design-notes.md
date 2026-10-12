# Companion product and design record

This record condenses the original workspace scope, phone-refinement, and fork-scan notes so the decisions travel with the source.

## Product boundary

The target is remote access to projects, Monos, and sessions already open in an isolated MonoCode desktop instance. The companion must preserve the user's normal daily MonoCode workflow, require no separate VPN app, and keep agents and provider credentials on the Mac.

The current implementation uses a shared React UI inside a Tauri iOS shell. A narrow desktop bridge forwards only supported session actions to the existing desktop owner. Pairing creates a revocable device identity; encrypted Iroh direct/relay transport provides reachability. This is a prototype architecture, not a release or service commitment.

The phone information architecture is Monos, then groups, projects, and sessions. It follows the connected Mac's resolved appearance where that has a phone equivalent. Chats retain the desktop transcript and composer language while using phone-sized navigation and touch targets.

## Supported prototype slice

The bridge exposes bounded session listing and reads, blank-session creation, follow-ups, approvals, stop, and advertised model/access configuration. Every mutation carries an exact request identity and current state preconditions. The desktop remains the sole process, provider, and transcript writer.

The scope intentionally excludes copying provider credentials, direct database access, arbitrary native commands, unbounded transcript transfer, and automatic replay of an uncertain mutation.

## Known gaps

- The unmodified daily MonoCode app cannot be attached retroactively; use the isolated companion desktop build.
- Push, general file browsing/attachments, complete settings sync, durable desktop receipts, production signing/notarization, and community relay operations are not implemented. Git changes/diffs and Inbox are available as read-only views.
- Physical-device validation remains necessary for camera permission, keyboard geometry, long suspension, network handoff, and real approval/stop races.
- The checked-in source icon is MonoCode's mark at `companion/mobile/src-tauri/icons/icon.png`. The iOS build wrapper regenerates the Xcode AppIcon catalog from that source; the simulator home-screen icon has been verified. Do not commit `src-tauri/gen/apple/`.

## Research provenance

The design was informed by source-level inspection of public MonoCode forks: `caisergan/monocode` for native pairing and transport ideas, `alexfoxtm/monocode` for same-desktop-session routing, and `404khai/monocode` for mobile information architecture. Their code was not copied. The desktop's existing UI tokens and components are reused from this checkout under the retained MIT license.

Superset was separately researched for product behavior such as host lifecycle and mobile reconnect patterns. No Superset source or checkout is part of this repository.
