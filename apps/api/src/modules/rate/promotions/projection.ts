import { promotionSummarySchema, type PromotionSummary } from '@pinehill/contracts';
import type { promotions } from '@prisma/client';
import { dateOnly } from '../calendar/support.js';

/**
 * Khuyến mãi của `GET /promotions`. Ngày lưu là ngày nghiệp vụ VN, bao gồm cả hai đầu ⇒ `validFrom` =
 * 00:00 giờ VN của ngày đầu, `validTo` = 23:59:59.999 giờ VN của ngày cuối (dạng UTC theo hợp đồng).
 */
export function promotionSummary(row: promotions): PromotionSummary {
  const version = Number(row.version);
  if (!Number.isSafeInteger(version)) throw new Error('PROMOTION_VERSION_UNREPRESENTABLE');
  const from = Date.parse(`${dateOnly(row.valid_from)}T00:00:00.000+07:00`);
  const to = Date.parse(`${dateOnly(row.valid_to)}T23:59:59.999+07:00`);
  return promotionSummarySchema.parse({
    id: row.id,
    code: row.code,
    type: row.type,
    value: Number(row.value),
    minNights: row.min_nights,
    channelScope: row.channel_scope,
    roomTypeScope: row.room_type_scope,
    validFrom: new Date(from).toISOString(),
    validTo: new Date(to).toISOString(),
    maxUses: row.max_uses,
    usedCount: row.used_count,
    stackable: row.stackable,
    status: row.status,
    version,
  });
}

/** Ảnh chụp audit: thêm ngày lưu thật và giá trị số gốc. */
export function promotionSnapshot(row: promotions) {
  return {
    ...promotionSummary(row),
    name: row.name,
    validFromDate: dateOnly(row.valid_from),
    validToDate: dateOnly(row.valid_to),
    valueExact: row.value.toString(),
  };
}
