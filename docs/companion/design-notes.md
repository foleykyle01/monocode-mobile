# Companion product and design record

This record condenses the original workspace scope, phone-refinement, and fork-scan notes so the decisions travel with the source.

## Product boundary

The target is remote access to projects, Monos, and sessions already open in an isolated MonoCode desktop instance. The companion must preserve the user's normal daily MonoCode workflow, require no separate VPN app, and keep agents and provider credentials on the Mac.

The current implementation uses a shared React UI inside a Tauri iOS shell. A narrow desktop bridge forwards only supported session actions to the existing desktop owner. Pairing creates a revocable device identity; encrypted Iroh direct/relay transport provides reachability. This is a prototype architecture, not a release or service commitment.

The phone home page shows Inbox, Monos, then groups, projects, and sessions. It follows the connected Mac's resolved appearance where that has a phone equivalent. Chats retain the desktop transcript and composer language while using phone-sized navigation and touch targets.

## Supported prototype slice

The bridge exposes bounded session listing and reads, blank-session creation, follow-ups, approvals, stop, and advertised model/access configuration. Every mutation carries an exact request identity and current state preconditions. The desktop remains the sole process, provider, and transcript writer.

The scope intentionally excludes copying provider credentials, direct database access, arbitrary native commands, unbounded transcript transfer, and automatic replay of an uncertain mutation.

## October 12: subtle surface depth

Code `1623a39` lightly raises host-derived panel, raised-surface and edge contrast.
Existing glass controls and Mono cards get a faint inner highlight and a soft
shadow; the composer, approval cards and session-change cards share that depth.
Layout, typography, theme choices and blur strength are unchanged.

TypeScript/UI build, native Mac preview and signed iPhone archive pass. Light and
dark home/chat views were visually checked in native WebKit; the preview's Light
setting was restored and the preview closed. No additional logic tests were needed
for the two-file CSS change. Physical-device appearance remains unverified; the
validation boundary is recorded in [validation scope](validation-public.md).

## October 13: touch feedback and chat contrast

October 13 (`d55bff3`): navigation hover/pressed fills now require a fine pointer
with hover capability to avoid iOS synthetic hover while scrolling. Keyboard
focus remains available; the actual selected session stays marked. A 4px gap
separates session highlights from adjacent rows. Chat bubbles retain their
host-derived border instead of overriding it to zero; composer fill uses the
panel token with a slightly clearer edge. No new gesture handlers or animations.
UI/native/device builds pass; installed on the connected phone. The user reported
that it looks much better; this is not a full gesture/lifecycle certification.
Native preview screenshots stayed at transition-start
frames this run, limiting visual verification; no animation code was changed.

## Known gaps

- The unmodified daily MonoCode app cannot be attached retroactively; use the isolated companion desktop build.
- Push, general file browsing/attachments, complete settings sync, durable desktop receipts, production signing/notarization, and community relay operations are not implemented. Git changes/diffs and Inbox are available as read-only views.
- Physical-device validation remains necessary for camera permission, keyboard geometry, long suspension, network handoff, and real approval/stop races.
- The checked-in source icon is MonoCode's mark at `companion/mobile/src-tauri/icons/icon.png`. The iOS build wrapper regenerates the Xcode AppIcon catalog from that source; the simulator home-screen icon has been verified. Do not commit `src-tauri/gen/apple/`.

## Research provenance

The design was informed by source-level inspection of public MonoCode forks: `caisergan/monocode` for native pairing and transport ideas, `alexfoxtm/monocode` for same-desktop-session routing, and `404khai/monocode` for mobile information architecture. Their code was not copied. The desktop's existing UI tokens and components are reused from this checkout under the retained MIT license.

Superset was separately researched for product behavior such as host lifecycle and mobile reconnect patterns. No Superset source or checkout is part of this repository.
