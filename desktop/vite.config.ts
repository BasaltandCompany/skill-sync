import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed dev port (match devUrl in src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [solid(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "chrome110" },
  // @basaltac/ui ships raw Solid .tsx — keep one shared copy, compile it in-pipeline.
  optimizeDeps: { exclude: ["@basaltac/ui"] },
});
