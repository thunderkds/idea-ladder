import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:54401", ...devices["Desktop Chrome"] },
  webServer: {
    command: "bun run build && bun e2e/serve.ts",
    url: "http://localhost:54401/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
