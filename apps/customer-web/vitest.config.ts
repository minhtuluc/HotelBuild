import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `tsconfig.json` để `jsx: preserve` (Next dựng JSX); vitest cần tự biên dịch JSX như operations-web.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
