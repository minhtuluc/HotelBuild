/**
 * Use case báo giá (HB-074, UC-RATE-05): `POST /quotes` — một con số **không đổi trong 15 phút**,
 * chỉ dùng được bởi đúng principal/kênh/kỳ (BR-RATE-15,17; api.md §3.1).
 *
 * Luồng giá **không** được tính ở đây: dữ kiện nạp qua loader HB-056 rồi giao cho engine
 * `@pinehill/domain/pricing` quyết (BR-RATE-17). Service này chỉ giữ **bất biến**: dựng quote, băm
 * fingerprint, lưu vào `RateQuoteStore` (Redis TTL 900 giây) và cung cấp `consume` cho HB-076/HB-077.
 *
 * `consume` là **điểm nối duy nhất** để tiêu thụ quote (giữ chỗ/đặt phòng) và cài đúng thứ tự kiểm của
 * api.md §3.1: mất cache/hết hạn ⇒ `410 E_RATE_QUOTE_EXPIRED`; khác principal hoặc khác **bất cứ**
 * trường nào trong fingerprint ⇒ `409 E_RATE_QUOTE_MISMATCH`. Thứ tự principal → fingerprint → hạn
 * trùng với journey giả đang chạy ở `tests/e2e/fake-api/journey`.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { quotePrice } from '@pinehill/domain/pricing';
import type { PricingError } from '@pinehill/domain/pricing';
import { quoteSchema } from '@pinehill/contracts';
import type { Quote } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { loadPricingFacts } from '../pricing-facts/loader.js';
import { civilDay } from '../calendar/support.js';
import { assertQuoteChannel } from './channel-policy.js';
import { quoteFingerprint } from './fingerprint.js';
import { principalKey } from './principal.js';
import { QUOTE_TTL_SECONDS, RateQuoteStore } from './store.js';
import type { StoredQuote } from './store.js';
import { consumedInput, quoteInput } from './validation.js';
import type { QuoteInput } from './validation.js';

/** Engine từ chối cấu hình/kỳ/khuyến mãi ⇒ 422 theo catalogue (cùng ánh xạ với HB-056). */
function engineFailure(error: PricingError): AppError {
  if (error.code === 'E_RATE_PROMOTION_INVALID')
    return new AppError(422, 'E_RATE_PROMO_INVALID', 'Mã khuyến mãi không hợp lệ cho kỳ này.');
  return new AppError(422, 'E_RATE_CONFIGURATION_INVALID', 'Cấu hình giá không hợp lệ cho kỳ này.');
}

/** `Fraction` của engine là phân số chính xác; đổi sang `number` **một lần** tại biên API. */
const numeric = (fraction: { readonly numerator: string; readonly denominator: string }): number =>
  Number(fraction.numerator) / Number(fraction.denominator);

const expired = () =>
  new AppError(410, 'E_RATE_QUOTE_EXPIRED', 'Báo giá đã hết hiệu lực, vui lòng lấy giá mới.');

const mismatched = () =>
  new AppError(409, 'E_RATE_QUOTE_MISMATCH', 'Báo giá không khớp yêu cầu hiện tại.');

export class RateQuoteService {
  constructor(
    readonly db: PrismaClient,
    readonly store: RateQuoteStore,
    readonly ids: IdGenerator,
    readonly clock: Clock,
  ) {}

  /**
   * Số đêm của kỳ `[checkIn, checkOut)`; BR-BOOK-03 + api.md §5: **cả** dưới `minNights` lẫn trên
   * `maxNights` đều là `422 E_BOOK_MIN_NIGHTS` (mã "số đêm không thoả gói giá đã chọn").
   */
  private assertPlanBounds(
    input: QuoteInput,
    plan: { minNights: number; maxNights: number },
  ): void {
    const nights = civilDay(input.checkOut) - civilDay(input.checkIn);
    if (nights < plan.minNights)
      throw new AppError(
        422,
        'E_BOOK_MIN_NIGHTS',
        `Gói giá yêu cầu tối thiểu ${plan.minNights} đêm.`,
      );
    if (nights > plan.maxNights)
      throw new AppError(
        422,
        'E_BOOK_MIN_NIGHTS',
        `Gói giá chỉ nhận tối đa ${plan.maxNights} đêm.`,
      );
  }

  async create(tx: Prisma.TransactionClient, principal: Principal, body: unknown): Promise<Quote> {
    const input = quoteInput(body);
    assertQuoteChannel(input.channelCode, principal);
    const facts = await loadPricingFacts(tx, {
      roomTypeId: input.roomTypeId,
      propertyId: input.propertyId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      ratePlanCode: input.ratePlanCode,
      promotionCodes: input.promotionCodes,
      // Phạm vi áp dụng mã khuyến mãi (`channel_scope`) chỉ kiểm được khi biết kênh ⇒ HB-199 buộc
      // `channelCode` đi kèm `promotionCodes`. Kênh đã bị kiểm quyền ngay trên bằng `assertQuoteChannel`
      // nên không mở giá OTA; HB-074 **không** tự lọc mã khuyến mãi (loader là nguồn duy nhất).
      channelCode: input.channelCode,
    });
    // api.md §5 dòng `E_BOOK_OVER_CAPACITY` + BR-BOOK-04: `adults + children` ≤ `capacityAdults × roomCount`.
    const room = await tx.room_types.findUnique({
      where: { id: input.roomTypeId },
      select: { capacity_adults: true },
    });
    if (!room) throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
    if (room.capacity_adults * input.roomCount < input.adults + input.children)
      throw new AppError(422, 'E_BOOK_OVER_CAPACITY', 'Số khách vượt sức chứa của loại phòng.');
    this.assertPlanBounds(input, facts.ratePlan);
    // `quoteSchema`/`bookingSummarySchema` (hợp đồng đã phát hành) khai `depositPercent` là **số nguyên**
    // trong khi `rate_plans.deposit_percent` là `numeric(5,2)`. Làm tròn sẽ khiến quote tự mâu thuẫn
    // (báo 13% nhưng `depositAmount` của engine tính trên 12,50%). Ở đây **từ chối** cấu hình không
    // biểu diễn được, giữ nguyên số của engine — không tự tính lại tiền cọc.
    const depositPercent = Number(facts.ratePlan.depositPercent);
    if (!Number.isInteger(depositPercent))
      throw new AppError(
        422,
        'E_RATE_CONFIGURATION_INVALID',
        'Tỷ lệ cọc của gói giá không biểu diễn được bằng số nguyên phần trăm.',
      );

    const result = quotePrice({ ...facts, channelCode: input.channelCode });
    if (!result.ok) throw engineFailure(result.error);
    const priced = result.value;
    const engineVersion = priced.engineVersion;
    // `quotedAt` lấy từ `Clock` tiêm (HB-013/không dùng `new Date()` trong miền) — engine đã chạy trên
    // cùng thời điểm thực, còn hạn 15 phút của quote là mốc máy chủ phát hành.
    const quotedAt = this.clock.now();
    const expiresAt = new Date(quotedAt.getTime() + QUOTE_TTL_SECONDS * 1_000);
    const quoteId = this.ids.generate();
    const nights = priced.nights.map((night) => ({
      date: night.date,
      basePrice: Number(night.base.numerator) / Number(night.base.denominator),
      // Hệ số trả đủ để web/Android/API đối chiếu cùng con số (api.md §3.1); đây là **tỷ lệ**
      // giữa hai bước liền kề của pipeline cố định BR-RATE-01, không phải công thức giá mới.
      seasonMultiplier: numeric(night.p1) / numeric(night.base),
      weekendMultiplier: numeric(night.p2) / numeric(night.p1),
      occupancyMultiplier: numeric(night.p3) / numeric(night.p2),
      losMultiplier: numeric(night.losMultiplier),
      channelMultiplier: numeric(night.p5) / numeric(night.p4),
      clamped: night.clamped !== null,
      nightlyPrice: night.nightlyPrice,
    }));
    const quote = quoteSchema.parse({
      quoteId,
      channelCode: input.channelCode,
      ratePlanCode: input.ratePlanCode,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights,
      subtotal: priced.subtotal,
      // Engine giữ `discount` chính xác; cắt **xuống** VND để không báo mức giảm lớn hơn mức đã trừ
      // (bước 11 BR-RATE-01 làm tròn xuống ở cấp tổng).
      discountAmount: Math.floor(numeric(priced.discountAmount)),
      total: priced.total,
      currency: 'VND',
      warnings: [...priced.warnings],
      depositPercent,
      depositAmount: priced.depositAmount,
      engineVersion,
      quotedAt: quotedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    await this.store.save(quoteId, {
      quote,
      fingerprint: quoteFingerprint(input, principalKey(principal), engineVersion),
      principal: principalKey(principal),
      engineVersion,
      input: {
        ...input,
        childAges: [...input.childAges],
        promotionCodes: [...input.promotionCodes],
      },
    });
    return quote;
  }

  /**
   * Tiêu thụ quote đã phát hành (HB-076 giữ chỗ, HB-077 đặt phòng): trả **nguyên** bản ghi đã lưu để
   * caller dùng tiếp (`quote.total`, `quote.nights[]`, `quoteId`) mà không tính lại giá.
   *
   * Thứ tự kiểm: đọc bản ghi (mất cache/TTL ⇒ 410) → cú pháp thân lệnh (thiếu trường ⇒ 400) → chủ thể
   * (409) → fingerprint (409) → hạn dùng (410). `consumedInput` nhận mã gói giá từ **bản ghi**: thân
   * lệnh `POST /holds` không có `ratePlanCode` (xem `validation.ts`).
   *
   * @throws AppError `410 E_RATE_QUOTE_EXPIRED` — không có khoá (mất cache/TTL) hoặc quá `expiresAt`.
   * @throws AppError `409 E_RATE_QUOTE_MISMATCH` — khác principal, hoặc fingerprint lệch.
   */
  async consume(quoteId: string, principal: Principal, body: unknown): Promise<StoredQuote> {
    const stored = await this.store.find(quoteId);
    if (stored === null) throw expired();
    const input = consumedInput(body, stored.input.ratePlanCode);
    if (stored.principal !== principalKey(principal)) throw mismatched();
    if (quoteFingerprint(input, stored.principal, stored.engineVersion) !== stored.fingerprint)
      throw mismatched();
    if (this.clock.now().getTime() >= Date.parse(stored.quote.expiresAt)) throw expired();
    return stored;
  }
}
