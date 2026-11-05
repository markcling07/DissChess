import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Uses a browser already on the machine, so no download is needed. Set PW_CHANNEL to use another.
const channel = process.env.PW_CHANNEL ?? "msedge";
const vite = "node node_modules/vite/bin/vite.js";
const python = resolve(
  import.meta.dirname,
  process.platform === "win32" ? "../../.venv/Scripts/python.exe" : "../../.venv/bin/python",
);
// A fake camera, so the camera flow can be tested on a machine with none.
const launchOptions = {
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: 4,
  forbidOnly: true,
  reporter: [["list"]],
  // Tests that need offline support turn service workers back on.
  use: { baseURL: "http://localhost:4173", channel, trace: "off", launchOptions, serviceWorkers: "block" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "phone",
      use: {
        viewport: devices["Pixel 7"].viewport,
        deviceScaleFactor: devices["Pixel 7"].deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
        userAgent: devices["Pixel 7"].userAgent,
      },
    },
  ],
  webServer: [
    {
      // The real recognition service, so these tests exercise the whole path with the real model.
      command: `"${python}" -m uvicorn --factory ptc_vision.api:create_app --host 127.0.0.1 --port 8000`,
      url: "http://127.0.0.1:8000/healthz",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `${vite} build && ${vite} preview --port 4173 --strictPort`,
      url: "http://localhost:4173",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
