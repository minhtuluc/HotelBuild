/**
 * Dữ kiện giá cho test HB-074 — dùng đúng số vàng `dong-gia.md` §5 ca 2 (CS-01 Đà Lạt, `DLX`, mùa
 * `SE-REUN`, 30/04–03/05/2026) để AC4 đối chiếu được với `POST /quotes/multi-channel` (HB-056) trên
 * **cùng** dữ kiện.
 *
 * Phụ thuộc `inventory-seed` (đã chèn 7 kênh + gói `FLEX7` + chính sách huỷ) nên file này phải được
 * import **sau** `fixture`. Chỉ bổ sung loại phòng DLX, mùa SE-REUN, công suất và tham số giá.
 */
import { beforeAll, beforeEach } from 'vitest';
import { rows, propertyId } from '../idempotency/database.js';

export const stay = { checkIn: '2026-04-30', checkOut: '2026-05-03' };
export const nights = ['2026-04-30', '2026-05-01', '2026-05-02'];
export let dlxTypeId = '';

/** Bảng kênh BR-RATE-07 (`02-nghiep-vu/dong-gia.md` §7.2) — cập nhật các kênh seed sẵn. */
const CHANNELS: readonly [string, number, number][] = [
  ['WEB', 1, 0],
  ['PHONE', 1, 0],
  ['WALKIN', 1.1, 0],
  ['AGENCY', 0.95, 10],
  ['OTA_BOOKING', 1.25, 18],
  ['OTA_AGODA', 1.22, 17],
  ['OTA_AIRBNB', 1.19, 15],
];

const PRICING_SETTINGS: readonly [string, string][] = [
  ['pricing.weekendMultiplier', '1.20'],
  ['pricing.occupancyMidPct', '80'],
  ['pricing.occupancyHighPct', '95'],
  ['pricing.maxDiscountPct', '30'],
];

beforeAll(async () => {
  dlxTypeId = String(
    (
      await rows(
        "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'DLX','Deluxe golden',3,1100000,680000,3000000) RETURNING id",
        [propertyId],
      )
    )[0]!.id,
  );
  for (const [code, multiplier, commissionPct] of CHANNELS)
    await rows('UPDATE channels SET multiplier=$2,commission_pct=$3 WHERE code=$1', [
      code,
      multiplier,
      commissionPct,
    ]);
  await rows(
    "INSERT INTO seasons(property_id,code,name,start_date,end_date,multiplier,priority,weekend_surcharge_enabled) VALUES($1,'SE-REUN','Lễ 30/04','2026-04-28','2026-05-03',1.80,80,false)",
    [propertyId],
  );
  // Gói mặc định phân giải qua chính sách huỷ `is_default` → `FLEX7` (đã seed sẵn).
  await rows("UPDATE cancellation_policies SET is_default=true WHERE code='H034'");
  for (const [key, value] of PRICING_SETTINGS)
    await rows(
      "INSERT INTO system_settings(key,value,value_type) VALUES($1,$2,'NUMBER') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
      [key, value],
    );
}, 60000);

beforeEach(async () => {
  await rows("UPDATE seasons SET multiplier=1.80 WHERE property_id=$1 AND code='SE-REUN'", [
    propertyId,
  ]);
  // HB-074 AC3 tự chen dòng giá đè; dọn trước mỗi test để không rò sang test sau.
  await rows('DELETE FROM rate_calendars WHERE room_type_id=$1', [dlxTypeId]);
  // Công suất 82% (bậc 80–94,99% → 1,15) phải còn "tươi" trong 5 phút ⇒ chụp lại mỗi test.
  await rows('DELETE FROM occupancy_snapshots WHERE property_id=$1', [propertyId]);
  for (const date of nights)
    await rows(
      'INSERT INTO occupancy_snapshots(property_id,room_type_id,date,physical_rooms,sold_rooms,occupancy_pct,captured_at) VALUES($1,NULL,$2,100,82,82,clock_timestamp())',
      [propertyId, date],
    );
});
