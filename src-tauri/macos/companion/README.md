# MonoCode Dev icon

The companion fork keeps MonoCode's unchanged artwork with a cobalt blue Icon
Composer fill. The daily app's black assets remain unchanged. Both packaged and
debug companion builds use this catalog; the bundle identifier stays
`com.monocode.companion-spike` to retain storage and phone pairing.

Regenerate with Xcode 26's asset compiler, from the repository root:

```sh
xcrun actool src-tauri/macos/companion/AppIcon.icon \
  --compile src-tauri/macos/companion \
  --platform macosx --minimum-deployment-target 13.0 \
  --app-icon AppIcon --output-partial-info-plist /tmp/monocode-dev-icon.plist \
  --output-format human-readable-text
```

Commit the source icon and compiled `AppIcon.icns` / `Assets.car` together.
The copied artwork matches `../AppIcon.icon/Assets/icon.png`. The variant only
changes the native fill to `#1757C2`; no generated raster artwork is involved.
Both default and dark fills are explicit: Icon Composer's automatic dark fill
otherwise becomes black, making the fork look like the daily app in dark mode.
Verify both renditions with Icon Composer's `ictool --export-image`, then check
the installed app in Finder. Inspecting only the ICNS fallback misses this bug.
The Windows/Linux icon remains unchanged. The iPhone icon uses the same source,
exported with Apple's iOS rendition:

```sh
"/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" \
  src-tauri/macos/companion/AppIcon.icon --export-image \
  --output-file companion/mobile/src-tauri/icons/icon.png \
  --platform iOS --rendition Default --width 1024 --height 1024 --scale 1
```

`npm run companion:ios` regenerates the iPhone asset catalog from this PNG and
flattens transparency against the same cobalt blue, avoiding a white icon box.
The phone bundle identifier remains `dev.monocode.companion` to preserve pairing.
