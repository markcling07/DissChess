import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Puts the engine where the browser can load it. The files come straight from the npm package. */
function copyEngine(): Plugin {
  return {
    name: "copy-engine",
    buildStart() {
      const source = resolve(import.meta.dirname, "node_modules/stockfish");
      const target = resolve(import.meta.dirname, "public/engine");
      mkdirSync(target, { recursive: true });
      for (const file of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) {
        copyFileSync(resolve(source, "bin", file), resolve(target, file));
      }
      copyFileSync(resolve(source, "Copying.txt"), resolve(target, "COPYING.txt"));
    },
  };
}

export default defineConfig({
  // Relative paths, so the same build works from a web host and inside Capacitor later.
  base: "./",
  plugins: [react(), copyEngine()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  preview: { proxy: { "/api": "http://127.0.0.1:8000" } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
