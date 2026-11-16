import { ApiError } from '@pinehill/api-client';
import { errorBodySchema } from '@pinehill/contracts';

/**
 * Lỗi HTTP từ BFF phiên → `ApiError` (HB-324, TD-41): giữ `code` của thân lỗi hợp đồng và thời gian chờ
 * từ header `Retry-After` (giây) hoặc `retryAfterSeconds` trong thân, để màn hình báo được "thử lại sau N
 * phút" thay vì một câu chung chung.
 */
export function retryAfterOf(response: Response, data: unknown): number | undefined {
  const header = response.headers.get('retry-after');
  if (header !== null && /^\d+$/.test(header.trim())) return Number(header.trim());
  const parsed = errorBodySchema.safeParse(data);
  return parsed.success ? parsed.data.retryAfterSeconds : undefined;
}

export function httpFailure(response: Response, data: unknown, message: string): ApiError {
  const parsed = errorBodySchema.safeParse(data);
  const wait = retryAfterOf(response, data);
  return new ApiError({
    kind: 'http',
    status: response.status,
    code: parsed.success ? parsed.data.code : undefined,
    ...(wait === undefined ? {} : { retryAfterSeconds: wait }),
    message,
  });
}
