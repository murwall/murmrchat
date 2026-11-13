import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  // The Matrix SDK + crypto are large; that's fine for a desktop app.
  build: { chunkSizeWarningLimit: 4000 },
  // Pre-bundle deps up front so the dev server never force-reloads the page mid-session
  // (a reload during an encryption-key upload can desync this device's keys with the server).
  optimizeDeps: {
    include: [
      "matrix-js-sdk",
      "matrix-js-sdk/lib/crypto-api",
      "dompurify",
      "marked",
      "emoji-picker-react",
      "@tauri-apps/api/core",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-notification",
      "@tauri-apps/plugin-opener",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
