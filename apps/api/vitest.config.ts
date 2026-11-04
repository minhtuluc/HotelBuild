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
    // Cột `date` của PostgreSQL được node-postgres giải mã thành nửa đêm **giờ địa phương**; trên máy
    // đặt Asia/Ho_Chi_Minh, `toISOString().slice(0,10)` của một ngày nghiệp vụ lùi mất một ngày và các
    // hợp đồng đọc ngày thô (`dayOf` của fixture) lệch. CI vốn chạy UTC; ghim ở đây để `pnpm test` cho
    // cùng kết quả trên mọi máy.
    env: { TZ: 'UTC' },
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 75 },
    },
  },
});
