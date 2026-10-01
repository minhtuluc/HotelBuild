import { defineConfig } from 'vitest/config';

// esbuild không phát `emitDecoratorMetadata`; code dùng `@Inject(token)` tường minh nên
// không cần reflection. Chỉ cần bật legacy decorators cho vitest (tsc build vẫn phát metadata).
export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
