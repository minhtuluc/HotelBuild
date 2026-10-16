import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  channelCodeSchema,
  multiChannelQuoteRequestSchema,
  multiChannelQuoteOptionSchema,
  multiChannelQuoteSchema,
  type ChannelCode,
  type MultiChannelQuote,
} from '@pinehill/contracts';
import { quotePrice } from '@pinehill/domain/pricing';
import type { PricingError } from '@pinehill/domain/pricing';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { loadPricingFacts } from '../pricing-facts/loader.js';
import type { PricingFacts } from '../pricing-facts/loader.js';

/**
 * Hợp đồng F3 khai `channelCodes` là bắt buộc (min 1); HB-062 AC4 yêu cầu **backend mặc định cả 7
 * kênh** khi khách không chọn kênh nào. Nhận thêm trường hợp bỏ trống là tập cha của hợp đồng
 * (0 phá vỡ), phần còn lại vẫn đúng schema đã phát hành.
 */
const requestSchema = multiChannelQuoteRequestSchema.extend({
  channelCodes: z.array(channelCodeSchema).max(7).optional(),
});

/** Lỗi engine giá (HB-052) là cấu hình/kỳ không hợp lệ với đầu vào này — trả 422 có mã catalogue. */
function engineFailure(error: PricingError): AppError {
  if (error.code === 'E_RATE_PROMOTION_INVALID')
    return new AppError(422, 'E_RATE_PROMO_INVALID', 'Mã khuyến mãi không hợp lệ cho kỳ này.');
  return new AppError(422, 'E_RATE_CONFIGURATION_INVALID', 'Cấu hình giá không hợp lệ cho kỳ này.');
}

/**
 * Một dòng so sánh kênh (BR-RATE-07,08,09): chạy engine trên cùng dữ kiện, trả giá gộp, hoa hồng,
 * giá thuần và cảnh báo (gồm `E_RATE_CHANNEL_PARITY` khi OTA thấp hơn WEB — engine đã tính sau kẹp).
 */
function channelOption(facts: PricingFacts, channelCode: ChannelCode) {
  const result = quotePrice({ ...facts, channelCode });
  if (!result.ok) throw engineFailure(result.error);
  const quote = result.value;
  const commissions = quote.nights.map((night) => night.commissionPercent);
  const first = commissions[0]!;
  const uniform = commissions.every(
    (fraction) =>
      fraction.numerator === first.numerator && fraction.denominator === first.denominator,
  );
  // `NightPrice.commissionPercent` là **phần trăm thô** (18 = 18%), không phải tỷ lệ ⇒ chia thêm 100.
  // Hoa hồng làm tròn xuống VND: đồng nhất cả kỳ ⇒ áp trên tổng; đổi hệ số giữa kỳ ⇒ cộng theo đêm.
  const commissionAmount = uniform
    ? Number((BigInt(quote.total) * BigInt(first.numerator)) / (BigInt(first.denominator) * 100n))
    : quote.nights.reduce(
        (sum, night) =>
          sum +
          Number(
            (BigInt(night.nightlyPrice) * BigInt(night.commissionPercent.numerator)) /
              (BigInt(night.commissionPercent.denominator) * 100n),
          ),
        0,
      );
  return multiChannelQuoteOptionSchema.parse({
    channelCode,
    nightlyFrom: Math.min(...quote.nights.map((night) => night.nightlyPrice)),
    totalFrom: quote.total,
    grossTotal: quote.total,
    commissionAmount,
    netTotal: quote.total - commissionAmount,
    ...(uniform ? { commissionPct: Number(first.numerator) / Number(first.denominator) } : {}),
    warnings: [...quote.warnings],
  });
}

export class QuotesMultiChannelService {
  constructor(readonly db: PrismaClient) {}

  /**
   * Báo giá đa kênh (UC-RATE-05): một đầu vào, chạy engine cho từng kênh được yêu cầu, **chỉ đọc** —
   * không tạo quote/snapshot (HB-056 AC4). Chỉ MANAGER+ trong phạm vi cơ sở của loại phòng.
   */
  async quote(actor: AuthorizedActor, body: unknown): Promise<MultiChannelQuote> {
    if (!['MANAGER', 'OWNER'].includes(actor.role))
      throw new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thực hiện thao tác này.');
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success || parsed.data.checkOut <= parsed.data.checkIn)
      throw new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
    const { roomTypeId, checkIn, checkOut } = parsed.data;
    const requested = parsed.data.channelCodes?.length
      ? parsed.data.channelCodes
      : channelCodeSchema.options;
    const response = await this.db.$transaction(
      async (tx) => {
        const facts = await loadPricingFacts(tx, { roomTypeId, checkIn, checkOut });
        requireProperty(actor, facts.propertyId);
        return {
          roomTypeId,
          checkIn,
          checkOut,
          options: [...new Set(requested)].map((code) => channelOption(facts, code)),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    return multiChannelQuoteSchema.parse(response);
  }
}
