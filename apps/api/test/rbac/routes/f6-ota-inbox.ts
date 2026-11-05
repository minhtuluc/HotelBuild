/**
 * F6 — webhook OTA (HB-128; api.md §5.1, §6.3).
 *
 * Tuyến `POST /api/v1/integrations/ota/{channel}/bookings` xác thực bằng **HMAC của simulator**, không
 * bearer: controller khai `@Public()` (đúng mẫu webhook PSP HB-095). `registered-routes.spec` chỉ ghép
 * oracle với route **có permission**, nên tuyến này không có khoá ở đây — thêm khoá sẽ làm hỏng đẳng thức
 * route ↔ oracle. Principal công bố `OTA_SIMULATOR_SERVICE` chỉ là dữ liệu OpenAPI (HB-120), không phải
 * vai trò nhân viên và không đi qua `RbacGuard`.
 *
 * Vì vậy tệp giữ đúng một bất biến: tuyến chữ ký **không** được xuất hiện trong oracle bearer. Ai thêm
 * khoá cho nó phải đổi cơ chế xác thực trước, và test này nói thẳng điều đó thay vì để lỗi lệch khoá khó đọc.
 */
import type { Oracle } from './types.js';

/** Đường dẫn đã công bố (api.md §5.1) — chuỗi thường trong oracle, không phải tham số Nest. */
export const OTA_INGESTION_ORACLE_PATH = 'integrations/ota/:channel/bookings';

export function f6OtaInbox(oracle: Oracle): void {
  for (const key of Object.keys(oracle)) {
    if (key.endsWith(`:${OTA_INGESTION_ORACLE_PATH}`))
      throw new Error(
        `${key}: webhook OTA xác thực bằng chữ ký HMAC (không bearer) — không có dòng oracle RBAC`,
      );
  }
}
