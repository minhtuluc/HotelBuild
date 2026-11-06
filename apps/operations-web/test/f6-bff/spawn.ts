import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/** Chạy một kịch bản ở tiến trình `tsx --conditions=react-server` và đọc báo cáo JSON ở stdout. */
export function run(script: string): Record<string, unknown> {
  const result = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      fileURLToPath(new URL(script, import.meta.url)),
    ],
    { encoding: 'utf8', timeout: 25_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  const value: unknown = JSON.parse(result.stdout);
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** Đọc một khoá của báo cáo như đối tượng (`{}` nếu không phải). */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
