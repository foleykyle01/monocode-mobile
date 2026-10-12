import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Keep the desktop usable while native apps and the simulator are open.
    maxWorkers: 1,
    fileParallelism: false,
  },
});
