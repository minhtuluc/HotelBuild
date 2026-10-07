import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['react-server'] },
  ssr: { resolve: { conditions: ['react-server'] } },
  test: {
    server: { deps: { inline: ['server-only'] } },
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
