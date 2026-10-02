/** Phần dùng chung khi khai path OpenAPI, tách khỏi `registry.ts` để các file `paths/f*.ts` tái dùng. */
import type { z } from 'zod';
import type { ErrorCode } from '../errors.js';

/** Mọi lệnh ghi cần `Idempotency-Key`; mã tương quan luôn gửi được (api.md §1.3). */
export const idempotencyHeaders = [
  {
    name: 'Idempotency-Key',
    in: 'header' as const,
    required: true,
    schema: { type: 'string' as const, format: 'uuid' },
    description: 'Bắt buộc cho mọi lệnh ghi; hiệu lực 24 giờ (api.md §1.3).',
  },
  {
    name: 'X-Correlation-Id',
    in: 'header' as const,
    required: false,
    schema: { type: 'string' as const },
    description: 'Mã tương quan do client sinh; server tự sinh nếu thiếu (kiến trúc §9).',
  },
];

export const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } },
});

/** Phản hồi lỗi dùng chung: mã lấy đúng từ danh mục §4.2 nên không thể lệch tài liệu. */
export function makeErrorResponse(component: z.ZodTypeAny) {
  return (...codes: readonly ErrorCode[]) => ({
    description: codes.join(', '),
    content: { 'application/json': { schema: component } },
  });
}

/** Prelude của lệnh ghi có xác thực: Bearer + Idempotency-Key/X-Correlation-Id. */
export const bearerWrite = (tags: readonly string[]) => ({
  tags: [...tags],
  security: [{ bearerAuth: [] }],
  parameters: idempotencyHeaders,
});

/** Tham số đường dẫn theo tên trường. */
export const pathParam = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
});

/** `If-Match` cho lệnh sửa đối tượng đã tồn tại (api.md §1.3). */
export const ifMatchHeader = {
  name: 'If-Match',
  in: 'header' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Phiên bản đọc gần nhất; thiếu → 428, lệch → 412 (api.md §1.3).',
};
