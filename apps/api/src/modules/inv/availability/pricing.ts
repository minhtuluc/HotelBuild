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
import { AppError } from '../../../common/app-error.js';
import { loadPricingFacts } from '../../rate/pricing-facts/index.js';
import { nightsBetween } from './validation.js';

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
  /**
   * Mốc duy nhất của cả phản hồi (từ `clock_timestamp()` của transaction). Mọi loại phòng được định
   * giá ở **cùng một thời điểm**, nên hệ số công suất và ngưỡng tươi 5 phút không lệch giữa các loại
   * trong cùng một kết quả tìm phòng.
   */
  readonly now: Date;
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
  // BR-BOOK-03: kỳ dài/ngắn hơn cửa sổ gói giá là lỗi nghiệp vụ của khách, không phải lỗi hệ thống.
  // Engine chỉ báo chung `E_RATE_INVALID_INPUT` nên phải chặn trước khi gọi.
  const nights = nightsBetween(query.checkIn, query.checkOut);
  if (nights < facts.ratePlan.minNights || nights > facts.ratePlan.maxNights)
    throw new AppError(
      422,
      'E_BOOK_MIN_NIGHTS',
      `Kỳ lưu trú phải từ ${facts.ratePlan.minNights} đến ${facts.ratePlan.maxNights} đêm.`,
    );
  const quote = quotePrice({ ...facts, now: query.now.getTime(), channelCode: query.channelCode });
  // Phần còn lại là bất biến cấu hình giá bị phá ⇒ mã hạ tầng của catalogue, không phải 500 trần.
  if (!quote.ok)
    throw new AppError(503, 'E_GEN_SERVICE_UNAVAILABLE', 'Chưa tính được giá cho kỳ lưu trú.');
  return {
    minNights: facts.ratePlan.minNights,
    maxNights: facts.ratePlan.maxNights,
    nightlyFrom: Math.min(...quote.value.nights.map((night) => night.nightlyPrice)),
    totalFrom: quote.value.total,
  };
}
