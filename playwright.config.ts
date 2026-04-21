import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  use: {
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:react',
    port: 5123,
    timeout: 120000,
    reuseExistingServer: true,
  },
})
