import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/openapi/generate.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 60 },
    },
  },
});
