/**
 * Nguồn tiền **duy nhất** của `GET /inventory/availability` (HB-075).
 *
 * Không định nghĩa lại luật giá ở đây: dữ kiện lấy từ loader HB-056
 * (`modules/rate/pricing-facts`) và con số do engine giá HB-052 quyết, đúng BR-RATE-17 —
 * cùng đầu vào cho `POST /quotes` và `/quotes/multi-channel` phải ra cùng kết quả.
 */
import type { Prisma } from '@prisma/client';
import type { ChannelCode } from '@pinehill/domain/inventory';
import { quotePrice } from '@pinehill/domain/pricing';
import { loadPricingFacts } from '../../rate/pricing-facts/index.js';

export interface StayPrice {
  readonly minNights: number;
  readonly maxNights: number;
  readonly nightlyFrom: number;
  readonly totalFrom: number;
}

export interface StayPriceQuery {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly channelCode: ChannelCode;
}

/**
 * `nightlyFrom` = đêm rẻ nhất trong kỳ; `totalFrom` = tổng engine chốt (endpoint không nhận mã
 * khuyến mãi nên bằng tổng tạm tính). `minNights`/`maxNights` là cửa sổ số đêm của gói giá mà
 * loader phân giải (mặc định: gói có `cancellation_policies.is_default`).
 */
export async function stayPrice(
  tx: Prisma.TransactionClient,
  query: StayPriceQuery,
): Promise<StayPrice> {
  const facts = await loadPricingFacts(tx, {
    propertyId: query.propertyId,
    roomTypeId: query.roomTypeId,
    checkIn: query.checkIn,
    checkOut: query.checkOut,
  });
  const quote = quotePrice({ ...facts, channelCode: query.channelCode });
  // Loader đã dựng đủ dữ kiện nên engine từ chối ở đây là bất biến cấu hình bị phá ⇒ lỗi hệ thống,
  // không phải lỗi đầu vào của khách (mã lỗi nghiệp vụ của loader vẫn đi thẳng ra ngoài).
  if (!quote.ok) throw new Error(`Availability pricing failed: ${quote.error.code}`);
  return {
    minNights: facts.ratePlan.minNights,
    maxNights: facts.ratePlan.maxNights,
    nightlyFrom: Math.min(...quote.value.nights.map((night) => night.nightlyPrice)),
    totalFrom: quote.value.total,
  };
}
