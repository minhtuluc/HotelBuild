/**
 * Nơi lưu `PriceQuote` (HB-074 AC1) — **Redis 7, khoá `quote:<quoteId>`, TTL 900 giây**, đúng
 * csdl.md §3 dòng `PriceQuote` và BR-RATE-15 (api.md §3.1).
 *
 * Vì sao **không** dùng bảng đã có: HB-074 không được thêm migration, và bảng duy nhất gần đúng là
 * `price_snapshots` — nhưng bảng đó có `booking_id NOT NULL` (chỉ tồn tại **sau** khi có booking),
 * `kind` chỉ nhận `ORIGINAL|RESCHEDULE|PARTIAL_CANCEL`, `quote_fingerprint` chỉ được khác NULL khi
 * `kind = 'ORIGINAL'`, và **không có** `expires_at`. Nhét quote 15 phút vào đó sẽ tạo bản ghi giá giả
 * cho booking chưa tồn tại (BR-RATE-16: snapshot là bản ghi bất biến lúc booking rời DRAFT — HB-077).
 *
 * Bản ghi lưu **đủ thông tin để xác minh mà không cần tính lại giá**: `quote` (toàn bộ phản hồi 201,
 * gồm `nights[]`, `total`, `engineVersion`, `quotedAt`, `expiresAt`), `fingerprint`, `principal`,
 * `engineVersion` và `input` đã chuẩn hoá. Nhờ vậy:
 * - hạn dùng kiểm bằng `expiresAt` **trong bản ghi**, không phụ thuộc việc khoá Redis còn sống hay
 *   `PTTL` đã về 0 — hết hạn ⇒ `410 E_RATE_QUOTE_EXPIRED`, yêu cầu báo giá mới (không tự tăng giá);
 * - mất khoá (TTL/eviction) ⇒ coi như mất cache ⇒ `410` (api.md §3.1);
 * - Redis **lỗi** (không đọc/ghi được) ⇒ `503 E_GEN_SERVICE_UNAVAILABLE`, **fail-closed**: không phát
 *   hành quote không kiểm chứng được và cũng không đoán giá mới.
 * Việc chốt bất biến khi booking rời DRAFT nằm ở `price_snapshots` (HB-077) — HB-074 chỉ giữ quote.
 */
import { quoteSchema } from '@pinehill/contracts';
import { z } from 'zod';
import { AppError } from '../../../common/app-error.js';
import type { RedisClient } from '../../../infrastructure/redis/redis.module.js';

/** BR-RATE-15 / api.md §3.1: hiệu lực 15 phút. */
export const QUOTE_TTL_SECONDS = 900;
export const QUOTE_KEY_PREFIX = 'quote:';

const identifier = z.string().min(1);
const fingerprintInputSchema = z.object({
  propertyId: identifier,
  roomTypeId: identifier,
  ratePlanCode: identifier,
  channelCode: identifier,
  checkIn: identifier,
  checkOut: identifier,
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  childAges: z.array(z.number().int()),
  roomCount: z.number().int().min(1),
  promotionCodes: z.array(z.string()),
});

export const storedQuoteSchema = z.object({
  /** Bản ghi bất biến: chính là phản hồi 201 đã phát cho khách. */
  quote: quoteSchema,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  /** `<TYPE>:<id>` — quote chỉ dùng được bởi đúng chủ thể đã yêu cầu. */
  principal: identifier,
  engineVersion: identifier,
  input: fingerprintInputSchema,
});

export type StoredQuote = z.infer<typeof storedQuoteSchema>;

const storageUnavailable = () =>
  new AppError(
    503,
    'E_GEN_SERVICE_UNAVAILABLE',
    'Chưa lưu được báo giá, vui lòng thử lại sau ít phút.',
  );

export class RateQuoteStore {
  constructor(readonly redis: RedisClient) {}

  private key(quoteId: string): string {
    return `${QUOTE_KEY_PREFIX}${quoteId}`;
  }

  /** Ghi quote với TTL 900 giây. Redis lỗi ⇒ 503 (không nuốt lỗi, không trả quote không lưu được). */
  async save(quoteId: string, record: StoredQuote): Promise<void> {
    try {
      await this.redis.set(this.key(quoteId), JSON.stringify(record), 'EX', QUOTE_TTL_SECONDS);
    } catch {
      throw storageUnavailable();
    }
  }

  /** Đọc quote; `null` = không có khoá (hết TTL/eviction) hoặc bản ghi hỏng ⇒ coi như mất cache. */
  async find(quoteId: string): Promise<StoredQuote | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(this.key(quoteId));
    } catch {
      throw storageUnavailable();
    }
    if (raw === null) return null;
    try {
      const parsed = storedQuoteSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
