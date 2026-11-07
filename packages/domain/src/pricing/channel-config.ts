/**
 * Cảnh báo **cấu hình** kênh (BR-RATE-07/09), tính từ hệ số và hoa hồng mặc định của kênh — không cần ngày,
 * loại phòng hay bước kẹp sàn/trần.
 *
 * Khác `quotePrice`: engine so **giá niêm yết sau kẹp** từng đêm nên bắt được ca trần chặn (TC-RATE-24);
 * hàm này chỉ trả lời "cấu hình hiện tại có đúng ngưỡng sàn không", dùng cho màn hình cấu hình kênh. Cùng phép
 * so sánh hữu tỉ chính xác của engine, không dùng số thực. `AGENCY` ngoài phạm vi (giá hợp đồng).
 */
import { compare, decimal, multiply, ONE, percent, subtract } from './arithmetic.js';
import type { PricingWarning } from './index.js';

export type ChannelRateWarning = Extract<
  PricingWarning,
  'E_RATE_CHANNEL_PARITY' | 'E_RATE_DIRECT_BELOW_BASE'
>;

export interface ChannelRateConfig {
  readonly code: string;
  /** Hệ số dạng chuỗi thập phân (`"1.25"`), cùng định dạng engine nhận. */
  readonly multiplier: string;
  readonly commissionPercent: string;
}

const DIRECT_CHANNELS: ReadonlySet<string> = new Set(['WEB', 'PHONE', 'WALKIN']);

/** Doanh thu thuần trên một đơn vị giá niêm yết cơ bản: `hệ số × (1 − hoa hồng%)` (BR-RATE-08). */
const netFactor = (channel: ChannelRateConfig) =>
  multiply(decimal(channel.multiplier), subtract(ONE, percent(channel.commissionPercent)));

/**
 * - `E_RATE_CHANNEL_PARITY`: kênh `OTA_*` có doanh thu thuần thấp hơn `WEB` cùng giá cơ bản (BR-RATE-09).
 * - `E_RATE_DIRECT_BELOW_BASE`: `WEB`/`PHONE`/`WALKIN` có hệ số < 1,00 (bán dưới giá niêm yết cơ bản).
 * `web` là cấu hình kênh `WEB` hiện hành; `null` khi không có thì không đánh giá cân bằng giá.
 */
export function channelConfigWarnings(
  channel: ChannelRateConfig,
  web: ChannelRateConfig | null,
): readonly ChannelRateWarning[] {
  const warnings: ChannelRateWarning[] = [];
  if (
    channel.code.startsWith('OTA_') &&
    web !== null &&
    compare(netFactor(channel), netFactor(web)) < 0
  )
    warnings.push('E_RATE_CHANNEL_PARITY');
  if (DIRECT_CHANNELS.has(channel.code) && compare(decimal(channel.multiplier), ONE) < 0)
    warnings.push('E_RATE_DIRECT_BELOW_BASE');
  return warnings;
}
