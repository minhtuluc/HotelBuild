import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Hai web app chạy độc lập (ADR-018): mỗi bề mặt một project E2E riêng. */
const APPS = [
  { name: 'customer-web', filter: '@pinehill/customer-web', port: 3001 },
  { name: 'operations-web', filter: '@pinehill/operations-web', port: 3002 },
] as const;

const fakeApiBaseUrl = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  projects: APPS.map((app) => ({
    name: app.name,
    use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${app.port}` },
  })),
  webServer: APPS.map((app) => ({
    command: `pnpm --filter ${app.filter} start`,
    cwd: root,
    url: `http://127.0.0.1:${app.port}/`,
    env: { NEXT_PUBLIC_API_BASE_URL: fakeApiBaseUrl },
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  })),
});
