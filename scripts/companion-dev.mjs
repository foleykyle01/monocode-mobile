import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = process.argv.includes("--build");
const child = spawn(
  npm,
  [
    "exec",
    "tauri",
    "--",
    ...(build ? ["build", "--bundles", "app"] : ["dev", "--no-watch"]),
    "--config",
    "src-tauri/tauri.companion.conf.json",
    "--features",
    "companion-spike",
  ],
  {
    env: {
      ...process.env,
      MONOCODE_DEV_APP_NAME: "MonoCode Dev",
      VITE_MONOCODE_COMPANION_SPIKE: "1",
    },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
