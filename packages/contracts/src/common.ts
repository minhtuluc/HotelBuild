/**
 * Quy ước chung của hợp đồng — nguồn chân lý: docs/04-thiet-ke/api.md §1.
 * Bao hình danh sách (`data` + `meta{limit,nextCursor,hasMore,total}`), phân trang con trỏ,
 * tiền số nguyên VND, thời gian ISO-8601 UTC, bao lỗi §4.1 và trạng thái tác vụ 202 (§6).
 */
import { z } from 'zod';
import { errorCodePattern, type ErrorCode } from './errors.js';

/** Mốc thời gian ISO-8601 UTC (api.md §1.2). Biểu thức tường minh để không phụ thuộc API zod-theo-phiên-bản. */
export const isoUtcTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
    'Phải là ISO-8601 UTC kết thúc bằng Z',
  );

/** Ngày nghiệp vụ theo giờ Việt Nam, dạng `YYYY-MM-DD` (NFR-LOC-02). */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày nghiệp vụ phải có dạng YYYY-MM-DD');

/** Tiền VND nguyên (BR-GEN-01, NFR-LOC-03): không số thực, không chuỗi. Phản hồi nên bỏ qua trường lạ. */
export const moneySchema = z.object({
  amount: z.number().int('Tiền phải là số nguyên VND'),
  currency: z.literal('VND'),
});

/** Mã lỗi: parse rộng để client cũ vẫn đọc được mã mới, rồi thu hẹp bằng `isErrorCode`. */
export const errorBodySchema = z.object({
  code: z.string().regex(errorCodePattern, 'Mã lỗi phải theo dạng E_<MOD>_<TÊN>'),
  message: z.string().min(1),
  traceId: z.string().min(1),
  timestamp: isoUtcTimestampSchema,
  path: z.string().min(1),
  details: z
    .array(z.strictObject({ field: z.string().min(1), issue: z.string().min(1) }))
    .optional(),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;

export function listResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z.strictObject({
      limit: z.number().int().min(1).max(100),
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
      total: z.number().int().min(0),
    }),
  });
}

/** Tham số phân trang/lọc dùng chung cho endpoint danh sách (api.md §1.4). */
export const listQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  sort: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
});

/** Tác vụ bất đồng bộ: mọi lệnh trả 202 kèm `operationId`/`statusUrl` (api.md §6). */
export const operationRefSchema = z.object({
  operationId: z.string().min(1),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  statusUrl: z.string().min(1),
});

export const operationStatusViewSchema = z.object({
  operationId: z.string().min(1),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  resultRef: z.string().min(1).optional(),
  errorCode: z.string().regex(errorCodePattern).optional(),
  errorMessage: z.string().min(1).optional(),
});

/** Header bắt buộc của mọi lệnh ghi (ADR-017): idempotency + tương quan + điều kiện phiên bản. */
export const writeRequestHeadersSchema = z.object({
  'idempotency-key': z.string().uuid('Idempotency-Key phải là UUIDv4 do client sinh'),
  'x-correlation-id': z.string().min(1).optional(),
  'if-match': z.string().min(1).optional(),
});

export type ErrorCodeName = ErrorCode;
