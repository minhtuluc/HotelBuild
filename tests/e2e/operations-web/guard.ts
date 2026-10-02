import { test } from '@playwright/test';

/**
 * Bỏ qua ca chỉ thuộc operations web. `pnpm test:e2e` chạy cả hai project (ADR-018), mà màn hình F2
 * chỉ tồn tại ở back-office.
 */
export function operationsWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('operations-web'), 'ca này chỉ chạy trên operations-web');
  });
}
