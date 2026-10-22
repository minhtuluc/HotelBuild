import { test as base, expect } from '@playwright/test';
import { loginCollectionStaff } from './collect-fixture';

/**
 * Ca E2E chạm khu vực `(ops)` phải có phiên nhân viên thật trước khi điều hướng: cổng HB-020 đưa mọi
 * màn chưa đăng nhập về `/login`, nên mọi assertion nội dung sẽ trượt nếu thiếu phiên.
 *
 * Auto fixture dùng chung thay vì chép `test.beforeEach` vào từng tệp: chỉ chạy trên project
 * `operations-web` (cùng trang `/states` của customer-web vẫn là khách, không phiên staff), và đăng nhập
 * **trước** thân ca — tức trước khi ca tự cài `page.route` cho `/api/session/**` hay `/api/v1/**`.
 *
 * `ops-auth.spec.ts` cố ý KHÔNG import tệp này: nó kiểm chính luồng chưa đăng nhập và chuyển hướng.
 */
export const test = base.extend<{ staffSession: void }>({
  staffSession: [
    async ({ page }, use, testInfo) => {
      if (testInfo.project.name.startsWith('operations-web')) await loginCollectionStaff(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
