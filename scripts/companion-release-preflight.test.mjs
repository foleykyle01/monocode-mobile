import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { readReleaseConfig, validateReleasePreflight } from "./companion-release-preflight.mjs";

const config = readReleaseConfig();
const macEnvironment = {
  TAURI_SIGNING_PRIVATE_KEY: "private-key",
  TAURI_UPDATER_PUBKEY: "public-key",
  TAURI_UPDATER_ENDPOINT: "https://updates.example.com/latest.json",
  MONOCODE_COMPANION_UPDATE_HOST: "updates.example.com",
  APPLE_CERTIFICATE: "certificate",
  APPLE_CERTIFICATE_PASSWORD: "certificate-password",
  APPLE_SIGNING_IDENTITY: "Developer ID Application: MonoCode (TEAMID)",
  APPLE_API_ISSUER: "issuer",
  APPLE_API_KEY: "key-id",
  APPLE_API_KEY_PATH: "/tmp/key.p8",
};
const testflightEnvironment = {
  APPLE_DEVELOPMENT_TEAM: "TEAM123456",
  APPLE_API_ISSUER: "67c6bb78-7c33-44c9-a7f8-fc7e3d9634b1",
  APPLE_API_KEY: "ABC123DE45",
  APPLE_API_KEY_P8: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }),
  IOS_BUILD_NUMBER: "1001",
};

test("accepts complete Mac and TestFlight release environments", () => {
  assert.deepEqual(validateReleasePreflight({ target: "mac", env: macEnvironment, config }), []);
  assert.deepEqual(validateReleasePreflight({ target: "testflight", env: testflightEnvironment, config }), []);
});

test("reports missing variable names without printing secret values", () => {
  const errors = validateReleasePreflight({ target: "mac", env: { ...macEnvironment, TAURI_SIGNING_PRIVATE_KEY: "" }, config });
  assert.deepEqual(errors, ["Missing: TAURI_SIGNING_PRIVATE_KEY"]);
  assert.equal(errors.join("\n").includes("private-key"), false);
});

test("rejects upstream and non-owned updater endpoints", () => {
  const upstream = validateReleasePreflight({
    target: "mac",
    env: { ...macEnvironment, TAURI_UPDATER_ENDPOINT: "https://github.com/hardbeat920/monocode/releases/latest/download/latest.json", MONOCODE_COMPANION_UPDATE_HOST: "github.com" },
    config,
  });
  assert.ok(upstream.includes("Invalid: TAURI_UPDATER_ENDPOINT"));
  const mismatched = validateReleasePreflight({
    target: "mac",
    env: { ...macEnvironment, MONOCODE_COMPANION_UPDATE_HOST: "other.example.com" },
    config,
  });
  assert.ok(mismatched.includes("Invalid: TAURI_UPDATER_ENDPOINT"));
});

test("protects companion identifiers and iOS version agreement", () => {
  const errors = validateReleasePreflight({
    target: "testflight",
    env: testflightEnvironment,
    config: { ...config, desktopIdentifier: "com.monocode.desktop", mobileCargoVersion: "0.1.2" },
  });
  assert.ok(errors.includes("Invalid config: desktop companion identifier"));
  assert.ok(errors.includes("Invalid config: iOS version metadata"));
});

test("requires automatic signing credentials and a numeric iOS build number", () => {
  const errors = validateReleasePreflight({
    target: "testflight",
    env: { ...testflightEnvironment, APPLE_DEVELOPMENT_TEAM: "TEAM", APPLE_API_KEY_P8: "not-a-key", IOS_BUILD_NUMBER: "2026.10131.1" },
    config,
  });
  assert.ok(errors.includes("Invalid: APPLE_DEVELOPMENT_TEAM"));
  assert.ok(errors.includes("Invalid: APPLE_API_KEY_P8"));
  assert.ok(errors.includes("Invalid: IOS_BUILD_NUMBER"));
});

test("rejects invalid Apple build formats and credentials embedded in feed URLs", () => {
  for (const build of ["0", "2026.1013.1", "1.2.3.4", "10000", "1.beta", "1;echo hello"]) {
    assert.ok(validateReleasePreflight({ target: "testflight", env: { ...testflightEnvironment, IOS_BUILD_NUMBER: build }, config }).includes("Invalid: IOS_BUILD_NUMBER"));
  }
  const errors = validateReleasePreflight({ target: "mac", env: { ...macEnvironment, TAURI_UPDATER_ENDPOINT: "https://user:password@updates.example.com/latest.json" }, config });
  assert.ok(errors.includes("Invalid: TAURI_UPDATER_ENDPOINT"));
});
