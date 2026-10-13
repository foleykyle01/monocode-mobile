import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BETA_FEED_URL,
  COMPANION_DESKTOP_IDENTIFIER,
  COMPANION_TEAM_ID,
  createBetaManifest,
  createReleaseConfig,
  releaseAssetNames,
  validateBetaManifest,
  versionedReleaseTag,
  writeBetaManifest,
} from "./companion-mac-release.mjs";

const root = process.cwd();
const version = "1.0.0-beta.1";
const identity = `Developer ID Application: MonoCode Dev (${COMPANION_TEAM_ID})`;

test("writes a companion-only Apple Silicon release overlay", () => {
  const config = createReleaseConfig({ root, version, publicKey: "updater-public-key", signingIdentity: identity });
  assert.equal(config.identifier, COMPANION_DESKTOP_IDENTIFIER);
  assert.equal(config.version, version);
  assert.equal(config.productName, "MonoCode Dev");
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(config.bundle.macOS.signingIdentity, identity);
  assert.deepEqual(config.plugins.updater.endpoints, [BETA_FEED_URL]);
  assert.equal(config.plugins.updater.pubkey, "updater-public-key");
});

test("rejects unexpected versions, identities, and missing public keys", () => {
  assert.throws(() => versionedReleaseTag("1.0.0"), /beta SemVer/);
  assert.throws(() => createReleaseConfig({ root, version, publicKey: "", signingIdentity: identity }), /missing updater public key/);
  assert.throws(() => createReleaseConfig({ root, version, publicKey: "key", signingIdentity: "Developer ID Application: Another Team (OTHERTEAM1)" }), /this team's Developer ID/);
});

test("creates an immutable versioned Apple Silicon manifest", () => {
  const names = releaseAssetNames(version);
  assert.deepEqual(names, {
    dmg: "MonoCode-Dev_1.0.0-beta.1_aarch64.dmg",
    updater: "MonoCode-Dev_1.0.0-beta.1_aarch64.app.tar.gz",
    signature: "MonoCode-Dev_1.0.0-beta.1_aarch64.app.tar.gz.sig",
  });
  const manifest = createBetaManifest({ version, signature: "signed updater", publishedAt: "2026-10-13T12:00:00.000Z" });
  assert.deepEqual(validateBetaManifest(manifest, version), []);
  assert.equal(manifest.platforms["darwin-aarch64"].url, `https://github.com/foleykyle01/monocode-mobile/releases/download/${versionedReleaseTag(version)}/${names.updater}`);
  assert.equal(Object.keys(manifest.platforms).length, 1);
});

test("rejects a channel URL, missing signature, or wrong platform manifest", () => {
  const manifest = createBetaManifest({ version, signature: "signature", publishedAt: "2026-10-13T12:00:00.000Z" });
  const channelUrl = structuredClone(manifest);
  channelUrl.platforms["darwin-aarch64"].url = BETA_FEED_URL;
  assert.ok(validateBetaManifest(channelUrl, version).includes("manifest updater URL is not immutable companion release URL"));
  assert.throws(() => createBetaManifest({ version, signature: "", publishedAt: "2026-10-13T12:00:00.000Z" }), /signature is empty/);
  const extraPlatform = structuredClone(manifest);
  extraPlatform.platforms["darwin-x86_64"] = extraPlatform.platforms["darwin-aarch64"];
  assert.ok(validateBetaManifest(extraPlatform, version).includes("manifest must contain only the Apple Silicon platform"));
});

test("writes a manifest from a signature file without putting the signature in output", () => {
  const directory = mkdtempSync(join(tmpdir(), "companion-mac-release-"));
  try {
    const signature = join(directory, "updater.sig");
    const output = join(directory, "latest.json");
    writeFileSync(signature, "test-signature\n");
    writeBetaManifest({ output, signaturePath: signature, version });
    const manifest = JSON.parse(readFileSync(output, "utf8"));
    assert.deepEqual(validateBetaManifest(manifest, version), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
