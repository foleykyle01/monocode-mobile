# Deleted projects on the phone

The Mac's `sessions.list.navigation.projects` is authoritative, including an
empty list. The phone must not reconstruct missing projects from session working
directories when this navigation snapshot is present. Older hosts that omit
navigation entirely retain the session-folder fallback.

The reported issue was reproduced through the live isolated host's read-only
bridge: it returned zero projects and a blank starter session with `cwd: "~"`.
The phone previously synthesized a project for that session after the real
project was removed. Re-pairing was successful and was not the cause.

The fix is in the shared phone/preview navigation builder. It does not delete
sessions, change pairing, or modify either desktop profile. Existing empty
projects and explicit worktree project identities remain supported.

Validation: all 85 companion UI tests passed with one worker (254 MiB peak
monitored process-group RSS), including empty navigation, an existing project
with no sessions, the legacy-host fallback, and successive rendered snapshots
removing a project while its old session remains. `git diff --check` passed.
Lighthouse is not applicable to this native Tauri navigation/data fix.

The signed iPhone archive and its TypeScript/production UI build passed (614 MiB
peak monitored process-group RSS). The first installation lost the CoreDevice
connection; after the user reconnected/unlocked the phone, installation succeeded
in place. Physical confirmation of the empty project list remains pending.

The user then requested the matching blue Dev icon. The iOS icon was exported
from the Mac Dev Icon Composer source, and the iOS generator uses the matching
blue background. That signed build also passed (600 MiB peak), and the combined
update was successfully installed with the same phone bundle identity.
