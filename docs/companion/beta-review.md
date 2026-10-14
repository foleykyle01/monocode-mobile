# TestFlight review and tester setup

These instructions apply to iPhone **0.1.1 (1004)** with **MonoCode Dev 1.0.0-beta.2** on an Apple Silicon Mac.

## Requirements

- An Apple Silicon Mac, an iPhone with TestFlight, and an internet connection.
- The [signed and notarized Mac installer](https://github.com/foleykyle01/monocode-mobile/releases/tag/companion-mac-v1.0.0-beta.2). Download the `.dmg`, open it, and drag **MonoCode Dev** into Applications. Existing Dev users should finish active work and quit Dev before replacing it; retain the existing profile and pairing.
- Your own supported [agent provider login](../providers.md) for agent conversations. The companion has no separate username/password account, hosted agent subscription, or shared review Mac. Build 1004 does not expose a sample mode.

## Pair and test

1. Open MonoCode Dev, open a disposable local project folder, and sign in to a supported provider. Start a short conversation on the Mac and confirm it responds.
2. On the Mac, open **Settings → Connections → Phone companion**, enable **Remote access**, and choose **Show QR code**.
3. In the iPhone app, choose **Scan QR ticket**, allow camera access, scan the code, and tap **Connect to Mac**. A pasted ticket also works. Invitations expire after five minutes and enroll one device.
4. Open the same project and conversation on the phone. Check the transcript, send a follow-up, and confirm it appears in the same Mac session. Test supported questions, approval prompts, and Stop using harmless work in the disposable project. Review **Inbox** and **Changes** when the Mac has relevant items.
5. Background and reopen the phone app to check reconnection. Open Settings and check Connection and appearance controls. Notifications and notification settings are intentionally absent in 1004. Keep the Mac awake and Dev open; after relaunching Dev, enable Remote access again.

The app is an independent MonoCode companion, not an official upstream release. It controls existing Mac sessions and does not run agents on the iPhone. No separate VPN app or router configuration is needed. Report feedback through TestFlight or **foley.kyle01@gmail.com**. See the [privacy page](privacy.md) before including screenshots or logs.
