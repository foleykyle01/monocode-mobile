# MonoCode Companion privacy

Updated October 18, 2026. This describes the independent MonoCode Companion iPhone beta **0.1.1 (1009)** and its connection to MonoCode Dev on your Mac.

## Your sessions and devices

The phone connects to the Mac you pair with. It receives workspace names, conversations, agent activity, questions, approvals, and file changes so you can view and control your existing sessions. Messages and actions you send from the phone go to that Mac. Project files, provider credentials, and authoritative conversation history remain managed by the Mac and its provider tools.

The companion does not send session content to a maintainer-operated application server. It uses Iroh for encrypted device-to-device connections, with public discovery and relay infrastructure when needed. Network services can observe connection metadata such as network addresses, endpoint identifiers, timing, and traffic volume; relay operators do not receive the decrypted session payload. Your selected agent providers and desktop integrations process data according to their own policies and your configuration.

## What the phone stores

Pairing credentials and an unresolved outgoing command are saved in the device's Apple Keychain. An unresolved command can include the message or action you sent, so its outcome can be checked before retrying. These Keychain entries are configured for access while the device is unlocked, without iCloud synchronization or migration to another device. Phone appearance preferences use local app storage; displayed conversations and drafts are held in the running interface.

Camera permission is used to scan the Mac's pairing QR code. The scanner returns the decoded ticket; the companion does not upload camera images. You can paste a pairing ticket instead. Build 1009 has notifications disabled and does not register for push notifications. The phone app includes no advertising or third-party product-analytics SDK.

## TestFlight and feedback

Apple automatically collects and shares TestFlight usage and crash information with the developer under its [TestFlight privacy terms](https://www.apple.com/legal/privacy/data/en/test-flight/). Feedback you submit can include screenshots, comments, and contact information. Email and GitHub reports are also received when you choose to send them. These records are used to investigate reports and improve the beta, and retained while needed for that purpose; you can request deletion from the maintainer at the address below. GitHub issues are public; remove private code, credentials, pairing tickets, and personal details before posting.

## Your controls and contact

Use **Forget Mac** in the phone's Settings to remove its saved pairing, after resolving any pending command. Revoke the phone separately in the Mac's **Settings → Connections → Phone companion** to remove its authorization. Turning off Remote access stops companion access while leaving your Mac's local sessions available. These actions do not delete your Mac's conversations, provider records, or feedback already submitted to Apple or the maintainer.

For privacy questions or requests concerning feedback you sent to the maintainer, contact **foley.kyle01@gmail.com**. Apple, GitHub, and your selected providers control their own service records. This page will be updated when the beta's data handling changes.
