import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DESKTOP_IDENTIFIER = "com.monocode.companion-spike";
const IOS_IDENTIFIER = "dev.monocode.companion";

const MAC_REQUIRED = [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_UPDATER_PUBKEY",
  "TAURI_UPDATER_ENDPOINT",
  "MONOCODE_COMPANION_UPDATE_HOST",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_PATH",
];

const TESTFLIGHT_REQUIRED = [
  "APPLE_DEVELOPMENT_TEAM",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_P8",
  "IOS_BUILD_NUMBER",
];

function value(env, name) {
  return typeof env[name] === "string" ? env[name].trim() : "";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readCargoVersion(path) {
  const match = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(path, "utf8"));
  return match?.[1] ?? "";
}

export function readReleaseConfig(root = ROOT) {
  const desktop = readJson(resolve(root, "src-tauri/tauri.companion.conf.json"));
  const mobile = readJson(resolve(root, "companion/mobile/src-tauri/tauri.conf.json"));
  const mobilePackage = readJson(resolve(root, "companion/mobile/package.json"));
  return {
    desktopIdentifier: desktop.identifier,
    desktopUpdaterEndpoints: desktop.plugins?.updater?.endpoints,
    mobileIdentifier: mobile.identifier,
    mobileVersion: mobile.version,
    mobilePackageVersion: mobilePackage.version,
    mobileCargoVersion: readCargoVersion(resolve(root, "companion/mobile/src-tauri/Cargo.toml")),
  };
}

function updateHost(valueToParse) {
  try {
    return new URL(valueToParse.includes("://") ? valueToParse : `https://${valueToParse}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isUnsafeUpdaterUrl(url) {
  const combined = `${url.hostname}${url.pathname}`.toLowerCase();
  return combined.includes("hardbeat920") || combined.includes("/monocode/releases");
}

function configurationErrors(config) {
  const errors = [];
  if (config.desktopIdentifier !== DESKTOP_IDENTIFIER) {
    errors.push("Invalid config: desktop companion identifier");
  }
  if (config.mobileIdentifier !== IOS_IDENTIFIER) {
    errors.push("Invalid config: iOS companion identifier");
  }
  if (!config.mobileVersion || config.mobileVersion !== config.mobilePackageVersion || config.mobileVersion !== config.mobileCargoVersion) {
    errors.push("Invalid config: iOS version metadata");
  }
  if (!Array.isArray(config.desktopUpdaterEndpoints)) {
    errors.push("Invalid config: desktop updater endpoints");
  } else if (config.desktopUpdaterEndpoints.some(endpoint => {
    try {
      return isUnsafeUpdaterUrl(new URL(endpoint));
    } catch {
      return true;
    }
  })) {
    errors.push("Invalid config: desktop updater endpoints");
  }
  return errors;
}

function requiredErrors(env, names) {
  return names.filter(name => !value(env, name)).map(name => `Missing: ${name}`);
}

function macErrors(env) {
  const errors = requiredErrors(env, MAC_REQUIRED);
  const endpoint = value(env, "TAURI_UPDATER_ENDPOINT");
  const updateHostName = updateHost(value(env, "MONOCODE_COMPANION_UPDATE_HOST"));
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    if (endpoint) errors.push("Invalid: TAURI_UPDATER_ENDPOINT");
  }
  if (!updateHostName && value(env, "MONOCODE_COMPANION_UPDATE_HOST")) {
    errors.push("Invalid: MONOCODE_COMPANION_UPDATE_HOST");
  }
  if (parsedEndpoint && (parsedEndpoint.protocol !== "https:" || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash || isUnsafeUpdaterUrl(parsedEndpoint) || !updateHostName || parsedEndpoint.hostname.toLowerCase() !== updateHostName)) {
    errors.push("Invalid: TAURI_UPDATER_ENDPOINT");
  }
  if (value(env, "APPLE_SIGNING_IDENTITY") && !value(env, "APPLE_SIGNING_IDENTITY").startsWith("Developer ID Application:")) {
    errors.push("Invalid: APPLE_SIGNING_IDENTITY");
  }
  return errors;
}

function testflightErrors(env) {
  const errors = requiredErrors(env, TESTFLIGHT_REQUIRED);
  if (value(env, "APPLE_DEVELOPMENT_TEAM") && !/^[A-Z0-9]{10}$/.test(value(env, "APPLE_DEVELOPMENT_TEAM"))) errors.push("Invalid: APPLE_DEVELOPMENT_TEAM");
  if (value(env, "APPLE_API_ISSUER") && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value(env, "APPLE_API_ISSUER"))) errors.push("Invalid: APPLE_API_ISSUER");
  if (value(env, "APPLE_API_KEY") && !/^[A-Z0-9]{10}$/.test(value(env, "APPLE_API_KEY"))) errors.push("Invalid: APPLE_API_KEY");
  if (value(env, "APPLE_API_KEY_P8")) {
    try {
      const key = createPrivateKey(value(env, "APPLE_API_KEY_P8"));
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("wrong key type");
    } catch {
      errors.push("Invalid: APPLE_API_KEY_P8");
    }
  }
  const build = value(env, "IOS_BUILD_NUMBER");
  if (build && !/^[1-9]\d{0,3}(?:\.\d{1,2}){0,2}$/.test(build)) {
    errors.push("Invalid: IOS_BUILD_NUMBER");
  }
  return errors;
}

export function validateReleasePreflight({ target, env = process.env, config = readReleaseConfig() }) {
  const errors = configurationErrors(config);
  if (target === "mac") return errors.concat(macErrors(env));
  if (target === "testflight") return errors.concat(testflightErrors(env));
  return ["Usage: node scripts/companion-release-preflight.mjs <mac|testflight>"];
}

function main() {
  const target = process.argv[2];
  let errors;
  try {
    errors = validateReleasePreflight({ target });
  } catch {
    console.error("Invalid config: companion release configuration");
    process.exitCode = 1;
    return;
  }
  if (errors.length) {
    console.error(`Companion ${target ?? "release"} preflight failed.`);
    for (const error of [...new Set(errors)]) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Companion ${target} release preflight passed.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
