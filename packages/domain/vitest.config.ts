import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Ca property 10.000 lượt (`test/pricing/engine.spec.ts` TC-RATE-22) chạy ~30,0–30,6s trên CI,
    // sát mốc mặc định 30s nên đỏ ngẫu nhiên; 60s vẫn giữ nguyên mọi khẳng định của ca.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 90 },
    },
  },
});
