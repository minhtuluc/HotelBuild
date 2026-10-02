import { ApiClient } from '@pinehill/api-client';

/**
 * Một chỗ duy nhất tạo `ApiClient` cho operations web (ADR-018: chỉ gọi `/api/v1` qua api-client).
 * Địa chỉ API truyền từ server component (đọc trong `src/config`), không đọc biến môi trường ở client:
 * biến `NEXT_PUBLIC_*` được nhúng lúc build nên client không thấy cấu hình lúc chạy (kiến trúc §7.5).
 */
export function opsApiClient(baseUrl: string): ApiClient {
  return new ApiClient({ baseUrl, maxAttempts: 2 });
}
