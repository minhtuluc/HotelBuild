/** Nối SCR-64 với tuyến ghi có sẵn qua `@pinehill/api-client` (không thêm endpoint). */
import {
  noShowRequestSchema,
  noShowResponseSchema,
  type NoShowResponse,
} from '@pinehill/contracts';
import type { Session } from '../session';
import type { NoShowBody } from './model';

/** Client ghim token/phiên hiện tại, đúng một lần gửi (không tự refresh/gửi lại), khoá idempotency do người gọi giữ. */
export async function sendNoShow(
  session: Session,
  body: NoShowBody,
  idempotencyKey: string,
): Promise<NoShowResponse> {
  const response = await session.resourceClient().request({
    method: 'POST',
    path: '/front-office/no-show',
    body: noShowRequestSchema.parse(body),
    idempotencyKey,
    decoder: noShowResponseSchema,
  });
  return response.data;
}
