import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: externalBaseURL
    ? undefined
    : [{
        command: "python -m uvicorn api.index:app --host 127.0.0.1 --port 8017",
        url: "http://127.0.0.1:8017/api/health",
        reuseExistingServer: true,
      }, {
        command: "pnpm dev --hostname 127.0.0.1",
        url: baseURL,
        reuseExistingServer: true,
        env: { CARENOTE_API_ORIGIN: "http://127.0.0.1:8017" },
      }],
});
