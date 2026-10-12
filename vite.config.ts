import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";
  const companion = mode === "companion";

  return {
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    build: {
      rollupOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          quickComposer: "quick-composer.html",
          monoChat: "mono-chat.html",
        },
      },
    },
    server: {
      port: companion ? 1430 : 1420,
      strictPort: true,
      host: host || false,
      // Keep the session owner alive while rebuilding the separate phone app.
      hmr: stable || companion
        ? false
        : host
          ? {
              protocol: "ws",
              host,
              port: companion ? 1431 : 1421,
            }
          : undefined,
      watch: {
        ignored: stable || companion ? ["**/*"] : ["**/src-tauri/**", "**/companion/**"],
      },
    },
  };
});
