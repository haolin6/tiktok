import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "apps/web/src/test",
  testMatch: "**/*.e2e.ts",
  timeout: 45_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run db:migrate && npm run db:seed && npm run dev",
    url: "http://127.0.0.1:3000/health",
    timeout: 120_000,
    reuseExistingServer: false
  }
});
