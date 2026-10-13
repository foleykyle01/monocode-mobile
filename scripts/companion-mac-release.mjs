import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const COMPANION_DESKTOP_IDENTIFIER = "com.monocode.companion-spike";
export const COMPANION_TEAM_ID = "RBT45GBH6K";
export const COMPANION_PRODUCT_NAME = "MonoCode Dev";
export const BETA_FEED_URL = "https://github.com/foleykyle01/monocode-mobile/releases/download/companion-updates-beta/latest.json";
export const BETA_FEED_TAG = "companion-updates-beta";
export const VERSIONED_RELEASE_PREFIX = "companion-mac-v";

function releaseError(message) {
  throw new Error(`Companion Mac release: ${message}`);
}

export function assertBetaVersion(version) {
  if (!/^\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(version)) {
    releaseError("version must be a beta SemVer value such as 1.0.0-beta.1");
  }
  return version;
}

export function versionedReleaseTag(version) {
  return `${VERSIONED_RELEASE_PREFIX}${assertBetaVersion(version)}`;
}

export function releaseAssetNames(version) {
  assertBetaVersion(version);
  const prefix = `MonoCode-Dev_${version}_aarch64`;
  return {
    dmg: `${prefix}.dmg`,
    updater: `${prefix}.app.tar.gz`,
    signature: `${prefix}.app.tar.gz.sig`,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function createReleaseConfig({ root = ROOT, version, publicKey, signingIdentity }) {
  assertBetaVersion(version);
  if (!publicKey?.trim()) releaseError("missing updater public key");
  if (!signingIdentity?.startsWith("Developer ID Application:") || !signingIdentity.includes(`(${COMPANION_TEAM_ID})`)) {
    releaseError("signing identity must be this team's Developer ID Application certificate");
  }
  const companion = readJson(join(root, "src-tauri/tauri.companion.conf.json"));
  if (companion.identifier !== COMPANION_DESKTOP_IDENTIFIER) {
    releaseError("companion desktop identifier changed");
  }
  return {
    ...companion,
    version,
    bundle: {
      ...companion.bundle,
      createUpdaterArtifacts: true,
      macOS: {
        ...companion.bundle?.macOS,
        signingIdentity,
      },
    },
    plugins: {
      ...companion.plugins,
      updater: {
        ...companion.plugins?.updater,
        pubkey: publicKey.trim(),
        endpoints: [BETA_FEED_URL],
      },
    },
  };
}

export function writeReleaseConfig({ output, ...options }) {
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, `${JSON.stringify(createReleaseConfig(options), null, 2)}\n`, { mode: 0o600 });
}

function releaseUrl(version, assetName) {
  return `https://github.com/foleykyle01/monocode-mobile/releases/download/${versionedReleaseTag(version)}/${assetName}`;
}

export function createBetaManifest({ version, signature, publishedAt = new Date().toISOString(), notes }) {
  const names = releaseAssetNames(version);
  const cleanSignature = signature?.trim();
  if (!cleanSignature) releaseError("updater signature is empty");
  if (!Number.isFinite(Date.parse(publishedAt))) releaseError("publication date is invalid");
  return {
    version,
    notes: notes?.trim() || `MonoCode Dev ${version}`,
    pub_date: publishedAt,
    platforms: {
      "darwin-aarch64": {
        signature: cleanSignature,
        url: releaseUrl(version, names.updater),
      },
    },
  };
}

export function validateBetaManifest(manifest, version) {
  const errors = [];
  try {
    assertBetaVersion(version);
  } catch (error) {
    return [error.message];
  }
  if (!manifest || typeof manifest !== "object") return ["manifest is not an object"];
  if (manifest.version !== version) errors.push("manifest version does not match");
  if (typeof manifest.notes !== "string" || !manifest.notes.trim()) errors.push("manifest notes are empty");
  if (typeof manifest.pub_date !== "string" || !Number.isFinite(Date.parse(manifest.pub_date))) errors.push("manifest publication date is invalid");
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== "object" || Object.keys(platforms).length !== 1 || !platforms["darwin-aarch64"]) {
    errors.push("manifest must contain only the Apple Silicon platform");
    return errors;
  }
  const platform = platforms["darwin-aarch64"];
  if (typeof platform.signature !== "string" || !platform.signature.trim()) errors.push("manifest signature is empty");
  if (platform.url !== releaseUrl(version, releaseAssetNames(version).updater)) errors.push("manifest updater URL is not immutable companion release URL");
  return errors;
}

export function writeBetaManifest({ output, signaturePath, version, notes }) {
  const manifest = createBetaManifest({ version, signature: readFileSync(signaturePath, "utf8"), notes });
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function command(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commandDiagnostics(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) releaseError("macOS signing inspection failed");
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function oneMatch(bundleDirectory, relativeDirectory, suffix) {
  const directory = join(bundleDirectory, relativeDirectory);
  const result = command("/usr/bin/find", [directory, "-maxdepth", "1", "-type", "f", "-name", `*${suffix}`, "-print"])
    .trim()
    .split("\n")
    .filter(Boolean);
  if (result.length !== 1) releaseError(`expected one ${suffix} artifact`);
  return result[0];
}

function oneApp(bundleDirectory) {
  const directory = join(bundleDirectory, "macos");
  const result = command("/usr/bin/find", [directory, "-maxdepth", "1", "-type", "d", "-name", "*.app", "-print"])
    .trim()
    .split("\n")
    .filter(Boolean);
  if (result.length !== 1) releaseError("expected one application bundle");
  return result[0];
}

function plistValue(app, key) {
  return command("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(app, "Contents", "Info.plist")]).trim();
}

function verifySignedApp(app, version, publicKey) {
  const info = {
    identifier: plistValue(app, "CFBundleIdentifier"),
    version: plistValue(app, "CFBundleShortVersionString"),
    executable: plistValue(app, "CFBundleExecutable"),
  };
  if (info.identifier !== COMPANION_DESKTOP_IDENTIFIER) releaseError("packaged bundle identifier does not match companion identity");
  if (info.version !== version) releaseError("packaged marketing version does not match release version");
  const executable = join(app, "Contents", "MacOS", info.executable);
  const arch = command("/usr/bin/lipo", ["-archs", executable]).trim();
  if (arch !== "arm64") releaseError("packaged executable is not Apple Silicon only");
  command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const signingInfo = commandDiagnostics("/usr/bin/codesign", ["-dv", "--verbose=4", app]);
  if (!signingInfo.includes(`TeamIdentifier=${COMPANION_TEAM_ID}`) || !signingInfo.includes("Authority=Developer ID Application:")) {
    releaseError("packaged bundle is not signed by the expected Developer ID team");
  }
  const embeddedConfiguration = readFileSync(executable);
  if (!embeddedConfiguration.includes(BETA_FEED_URL) || !embeddedConfiguration.includes(publicKey.trim())) {
    releaseError("packaged app does not contain the expected updater configuration");
  }
  return { ...info, executable };
}

function verifyDmgApp(dmg, version, publicKey, expectedExecutable) {
  const attached = command("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noverify", dmg]);
  const mount = attached.split("\n").map(line => line.trim().split("\t").at(-1)).find(path => path?.startsWith("/Volumes/"));
  if (!mount) releaseError("could not mount packaged DMG");
  try {
    const app = command("/usr/bin/find", [mount, "-maxdepth", "2", "-type", "d", "-name", "*.app", "-print"]).trim().split("\n").filter(Boolean);
    if (app.length !== 1) releaseError("DMG must contain exactly one application bundle");
    const appInfo = verifySignedApp(app[0], version, publicKey);
    const expectedHash = command("/usr/bin/shasum", ["-a", "256", expectedExecutable]).trim().split(/\s+/)[0];
    const dmgHash = command("/usr/bin/shasum", ["-a", "256", appInfo.executable]).trim().split(/\s+/)[0];
    if (expectedHash !== dmgHash) releaseError("DMG application executable differs from signed release application");
  } finally {
    command("/usr/bin/hdiutil", ["detach", mount, "-force"]);
  }
}

export function verifyMacBundle(bundleDirectory, version, publicKey = process.env.TAURI_UPDATER_PUBKEY) {
  assertBetaVersion(version);
  if (!publicKey?.trim()) releaseError("missing updater public key for package verification");
  const app = oneApp(bundleDirectory);
  const appInfo = verifySignedApp(app, version, publicKey);
  const updater = oneMatch(bundleDirectory, "macos", ".app.tar.gz");
  const signature = oneMatch(bundleDirectory, "macos", ".app.tar.gz.sig");
  const dmg = oneMatch(bundleDirectory, "dmg", ".dmg");
  if (!readFileSync(signature, "utf8").trim()) releaseError("updater signature is empty");
  command("/usr/bin/xcrun", ["stapler", "validate", app]);
  command("/usr/bin/xcrun", ["stapler", "validate", dmg]);
  verifyDmgApp(dmg, version, publicKey, appInfo.executable);
  return { app, updater, signature, dmg };
}

function usage() {
  console.error("Usage: node scripts/companion-mac-release.mjs <config|manifest|verify|check-manifest> ...");
  process.exitCode = 1;
}

function main() {
  const [action, ...args] = process.argv.slice(2);
  try {
    if (action === "config" && args.length === 2) {
      writeReleaseConfig({ output: args[0], version: args[1], publicKey: process.env.TAURI_UPDATER_PUBKEY, signingIdentity: process.env.APPLE_SIGNING_IDENTITY });
      console.log("Companion Mac release config written.");
      return;
    }
    if (action === "manifest" && args.length === 3) {
      writeBetaManifest({ output: args[0], signaturePath: args[1], version: args[2], notes: process.env.COMPANION_RELEASE_NOTES });
      console.log("Companion Mac beta manifest written.");
      return;
    }
    if (action === "verify" && args.length === 2) {
      verifyMacBundle(args[0], args[1]);
      console.log("Companion Mac package verified.");
      return;
    }
    if (action === "check-manifest" && args.length === 2) {
      const errors = validateBetaManifest(readJson(args[0]), args[1]);
      if (errors.length) releaseError(errors.join("; "));
      console.log("Companion Mac beta manifest verified.");
      return;
    }
    usage();
  } catch (error) {
    // Do not echo paths or subprocess output: release paths can contain credential-derived names.
    console.error(error instanceof Error ? error.message : "Companion Mac release validation failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
