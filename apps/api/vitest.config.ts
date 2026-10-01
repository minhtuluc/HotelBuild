import { defineConfig } from 'vitest/config';

// vitest dùng esbuild (không phát emitDecoratorMetadata) → code dùng @Inject tường minh.
export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 75 },
    },
  },
});
