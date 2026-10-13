"""Check a decoded TestFlight package before uploading it (never prints secrets)."""

import json
import os
from pathlib import Path
import plistlib
import re


def validate_ios_distribution(info, profile, *, team, version, build):
    errors = []
    identifier = "dev.monocode.companion"
    expected = {
        "CFBundleIdentifier": identifier,
        "CFBundleShortVersionString": version,
        "CFBundleVersion": build,
    }
    for key, value in expected.items():
        if info.get(key) != value:
            errors.append(f"Packaged {key} does not match release configuration")
    sdk = re.fullmatch(r"iphoneos(\d+)(?:\.\d+)*", info.get("DTSDKName", ""))
    if not sdk or int(sdk.group(1)) < 26:
        errors.append("App Store Connect requires a build made with iOS SDK 26 or newer")
    entitlements = profile.get("Entitlements", {})
    if profile.get("TeamIdentifier") != [team]:
        errors.append("Provisioning team does not match release configuration")
    if entitlements.get("application-identifier") != f"{team}.{identifier}":
        errors.append("Provisioning application identifier does not match")
    if entitlements.get("get-task-allow") is not False:
        errors.append("Distribution must disable debugging")
    if "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices"):
        errors.append("Development, ad hoc and enterprise provisioning are not TestFlight distribution")
    return errors


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    app = Path(os.environ["VERIFY_DIR"]) / "Payload/MonoCode Companion.app"
    with (app / "Info.plist").open("rb") as file:
        info = plistlib.load(file)
    with (Path(os.environ["RUNNER_TEMP"]) / "companion-profile.plist").open("rb") as file:
        profile = plistlib.load(file)
    version = json.loads((root / "companion/mobile/src-tauri/tauri.conf.json").read_text())["version"]
    errors = validate_ios_distribution(
        info, profile, team=os.environ["APPLE_DEVELOPMENT_TEAM"],
        version=version, build=os.environ["IOS_BUILD_NUMBER"],
    )
    if errors:
        raise SystemExit("\n".join(errors))
    print("TestFlight package identity, version and provisioning verified.")
