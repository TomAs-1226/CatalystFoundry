import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1512, height: 1050 },
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1512, height: 1050 },
      launchOptions: {
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : process.platform === 'linux' ? { executablePath: '/usr/bin/chromium' } : {}),
        args: process.platform === 'linux' ? ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
      },
    },
  }],
});
