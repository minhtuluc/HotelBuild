import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Hai web app chạy độc lập (ADR-018): mỗi bề mặt một project E2E riêng. */
const APPS = [
  {
    name: 'customer-web',
    filter: '@pinehill/customer-web',
    port: Number(process.env.E2E_CUSTOMER_WEB_PORT ?? 3001),
  },
  {
    name: 'operations-web',
    filter: '@pinehill/operations-web',
    port: Number(process.env.E2E_OPERATIONS_WEB_PORT ?? 3002),
  },
] as const;

const fakeApiBaseUrl = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1';

/**
 * Trình duyệt chạy E2E. Mặc định chỉ Chromium (dev chỉ cài Chromium);
 * nightly đặt `E2E_BROWSERS=chromium,webkit` để phủ Safari (NFR-USE-04).
 */
const BROWSERS = {
  chromium: devices['Desktop Chrome'],
  webkit: devices['Desktop Safari'],
} as const;
type BrowserName = keyof typeof BROWSERS;
const isBrowserName = (value: string): value is BrowserName => Object.hasOwn(BROWSERS, value);

const requested = (process.env.E2E_BROWSERS ?? 'chromium').split(',').map((value) => value.trim());
const unknown = requested.filter((value) => !isBrowserName(value));
if (unknown.length > 0) throw new Error(`E2E_BROWSERS không hợp lệ: ${unknown.join(', ')}`);
const browsers = requested.filter(isBrowserName);

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // Tên project giữ nguyên cho Chromium để log/lệnh cũ không đổi; trình duyệt khác thêm hậu tố.
  projects: browsers.flatMap((browser) =>
    APPS.map((app) => ({
      name: browser === 'chromium' ? app.name : `${app.name}-${browser}`,
      use: { ...BROWSERS[browser], baseURL: `http://127.0.0.1:${app.port}` },
    })),
  ),
  webServer: [
    {
      command: 'pnpm --filter @pinehill/api exec tsx ../../tests/e2e/fake-api/server.ts',
      cwd: root,
      url: `${fakeApiBaseUrl}/system/health`,
      env: {
        E2E_API_BASE_URL: fakeApiBaseUrl,
        E2E_APP_ORIGINS: APPS.map((app) => `http://127.0.0.1:${app.port}`).join(','),
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...APPS.map((app) => ({
      command: `pnpm --filter ${app.filter} exec next start --port ${app.port}`,
      cwd: root,
      url: `http://127.0.0.1:${app.port}/`,
      env: {
        NEXT_PUBLIC_API_BASE_URL: fakeApiBaseUrl,
        SESSION_APP_ORIGIN: `http://127.0.0.1:${app.port}`,
      },
      reuseExistingServer: process.env.CI === undefined,
      timeout: 120_000,
    })),
  ],
});
