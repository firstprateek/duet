import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Tauri expects a fixed port; the browser preview (`pnpm dev:web`) uses 5174. The demo on the
// website (`--mode demo`) lives in a subfolder, so its paths are relative.
export default defineConfig(({ mode }) => ({
  base: mode === "demo" ? "./" : "/",
  clearScreen: false,
  server: {
    port: mode === "web" ? 5174 : 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  worker: { format: "es" },
  // sql.js is CommonJS: pre-bundling gives it an ES default export. Its wasm is loaded by URL.
  optimizeDeps: { include: ["sql.js"] },
}));
