import { defineConfig, devices } from "@playwright/test";

// Uses a browser already on the machine, so no download is needed. Set PW_CHANNEL to use another.
const channel = process.env.PW_CHANNEL ?? "msedge";
const vite = "node node_modules/vite/bin/vite.js";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: 4,
  forbidOnly: true,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4173", channel, trace: "off" },
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
  webServer: {
    command: `${vite} build && ${vite} preview --port 4173 --strictPort`,
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
