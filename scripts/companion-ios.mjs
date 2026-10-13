import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Command exited ${code}`)));
  });
}

async function syncIosIcons() {
  const target = join(root, "companion/mobile/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset");
  const generated = await mkdtemp(join(tmpdir(), "monocode-ios-icons-"));
  await run("npm", ["run", "tauri", "--", "icon", "--ios-color", "#1757C2", "-o", generated, "src-tauri/icons/icon.png"], join(root, "companion/mobile"));
  // Apple rejects an alpha channel even when all its pixels are opaque.
  await run("xcrun", ["swift", join(root, "scripts/companion-ios-icons.swift"), join(generated, "ios"), target], root);
}

try {
  await run("npm", ["run", "companion:build"], root);
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "build") await syncIosIcons();
  if (args.includes("aarch64-sim")) {
    // Tauri renames into this path but cannot replace a previous simulator bundle.
    const previous = join(root, "companion/mobile/src-tauri/gen/apple/build/arm64-sim/MonoCode Companion.app");
    const backup = await mkdtemp(join(tmpdir(), "monocode-simulator-"));
    try { await rename(previous, join(backup, "MonoCode Companion.app")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await run("npm", ["run", "tauri", "--", "ios", ...(args.length ? args : ["build", "--debug", "--archive-only"])], join(root, "companion/mobile"));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
