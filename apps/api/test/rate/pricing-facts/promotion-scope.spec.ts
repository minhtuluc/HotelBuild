/**
 * HB-199 — kiểm **phạm vi áp dụng** của mã khuyến mãi ở ranh giới loader (`modules/rate/pricing-facts`)
 * trên CSDL thật: sai kênh, sai loại phòng, chưa đủ `min_nights`, ngoài cửa sổ, và ca hợp lệ.
 *
 * Căn cứ: BR-RATE-14 và api.md §3.1 (mã hết hạn/hết lượt ⇒ `422 E_RATE_PROMO_INVALID`) cùng bảng mã lỗi
 * §5 (nhóm nguyên nhân "hết hạn, hết lượt, **sai kênh/loại phòng**"). Cửa sổ `valid_from`/`valid_to` do
 * engine thi hành trên `Promotion` của domain — loader chỉ ánh xạ đúng cột — nên ca ngoài cửa sổ khẳng
 * định lỗi đã công bố của engine (`E_RATE_PROMOTION_INVALID`, bề mặt map `422 E_RATE_PROMO_INVALID`).
 *
 * Dữ kiện nền: `quotes-multi/seed` (DLX · SE-REUN · công suất 82% · gói mặc định FLEX7) và
 * `inventory-seed` (7 kênh, gói giá, chính sách huỷ, loại phòng `STD` cùng cơ sở).
 */
import { beforeEach, expect, test } from 'vitest';
import type { ChannelCode } from '@pinehill/contracts';
import { quotePrice } from '@pinehill/domain/pricing';
import { typeId } from '../../room-blocks/inventory-seed.js';
import { db, dlxTypeId, rows, stay } from '../quotes-multi/seed.js';
import { loadPricingFacts } from '../../../src/modules/rate/pricing-facts/loader.js';

/** Cửa sổ hiệu lực rộng cho ca "đang hiệu lực" — không phụ thuộc đồng hồ thật của CSDL. */
const OPEN_FROM = '2026-01-01';
const OPEN_TO = '2099-12-31';

interface PromotionOptions {
  readonly value?: number;
  readonly minNights?: number;
  readonly channelScope?: readonly string[];
  readonly roomTypeScope?: readonly string[];
  readonly validFrom?: string;
  readonly validTo?: string;
}

/** Chèn mã `PERCENT` `ACTIVE` bằng đúng các cột thật của `promotions` (csdl.md §3). */
async function promotion(code: string, options: PromotionOptions = {}): Promise<string> {
  await rows(
    `INSERT INTO promotions(code,name,type,value,min_nights,channel_scope,room_type_scope,valid_from,valid_to,stackable,status)
     VALUES($1,$1,'PERCENT',$2,$3,$4,$5,$6,$7,false,'ACTIVE')`,
    [
      code,
      options.value ?? 10,
      options.minNights ?? 1,
      [...(options.channelScope ?? [])],
      [...(options.roomTypeScope ?? [])],
      options.validFrom ?? OPEN_FROM,
      options.validTo ?? OPEN_TO,
    ],
  );
  return code;
}

/** Đường nạp **không** khuyến mãi — mốc so sánh giá gốc. */
const loadPlain = (roomTypeId = dlxTypeId) =>
  db.$transaction((tx) =>
    loadPricingFacts(tx, { roomTypeId, checkIn: stay.checkIn, checkOut: stay.checkOut }),
  );

/** Nạp dữ kiện **có** mã: HB-199 buộc khai kênh cùng mã vì phạm vi kênh của mã chỉ kiểm được khi biết kênh. */
const loadWithCodes = (
  promotionCodes: readonly string[],
  channelCode: ChannelCode,
  roomTypeId = dlxTypeId,
) =>
  db.$transaction((tx) =>
    loadPricingFacts(tx, {
      roomTypeId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      promotionCodes,
      channelCode,
    }),
  );

beforeEach(async () => {
  await rows("DELETE FROM promotions WHERE code LIKE 'H199-%'");
});

test('mã hợp lệ (WEB · DLX · tối thiểu 2 đêm · đang hiệu lực) vẫn giảm giá đúng 10%', async () => {
  const code = await promotion('H199-WEB-OK', {
    channelScope: ['WEB'],
    roomTypeScope: ['DLX'],
    minNights: 2,
  });
  const facts = await loadWithCodes([code], 'WEB');
  expect(facts.promotions.map((promotion) => promotion.code)).toEqual([code]);
  const plain = quotePrice({ ...(await loadPlain()), channelCode: 'WEB' });
  const priced = quotePrice({ ...facts, channelCode: 'WEB' });
  expect(plain.ok && priced.ok).toBe(true);
  if (!plain.ok || !priced.ok) return;
  expect(priced.value.appliedPromotions).toEqual([code]);
  expect(priced.value.total).toBeLessThan(plain.value.total);
  // BR-RATE-10: PERCENT áp **một lần trên tổng tạm tính**; phần giảm là phân số chính xác.
  expect(
    Number(priced.value.discountAmount.numerator) / Number(priced.value.discountAmount.denominator),
  ).toBe(plain.value.subtotal / 10);
});

test('sai kênh: mã chỉ dành OTA_BOOKING bị 422 ở kênh WEB, vẫn áp đúng ở OTA_BOOKING', async () => {
  const code = await promotion('H199-OTA', { channelScope: ['OTA_BOOKING'] });
  await expect(loadWithCodes([code], 'WEB')).rejects.toMatchObject({
    status: 422,
    code: 'E_RATE_PROMO_INVALID',
  });
  const ota = await loadWithCodes([code], 'OTA_BOOKING');
  expect(ota.promotions.map((promotion) => promotion.code)).toEqual([code]);
});

test('sai loại phòng: mã chỉ dành STD bị 422 ở DLX, vẫn áp đúng ở STD', async () => {
  const code = await promotion('H199-STD', { roomTypeScope: ['STD'] });
  await expect(loadWithCodes([code], 'WEB')).rejects.toMatchObject({
    status: 422,
    code: 'E_RATE_PROMO_INVALID',
  });
  const std = await loadWithCodes([code], 'WEB', typeId);
  expect(std.promotions.map((promotion) => promotion.code)).toEqual([code]);
});

test('ranh giới min_nights: đủ đêm thì áp; chưa đủ thì mã bị bỏ — không lỗi, tổng không đổi', async () => {
  const enough = await promotion('H199-3N', { minNights: 3 });
  const short = await promotion('H199-4N', { minNights: 4 });
  expect(
    (await loadWithCodes([enough], 'WEB')).promotions.map((promotion) => promotion.code),
  ).toEqual([enough]);
  const facts = await loadWithCodes([short], 'WEB');
  expect(facts.promotions).toEqual([]);
  const plain = quotePrice({ ...(await loadPlain()), channelCode: 'WEB' });
  const priced = quotePrice({ ...facts, channelCode: 'WEB' });
  expect(plain.ok && priced.ok).toBe(true);
  if (!plain.ok || !priced.ok) return;
  expect(priced.value.appliedPromotions).toEqual([]);
  expect(priced.value.total).toBe(plain.value.total);
});

test('ngoài cửa sổ: mã hết hiệu lực không giảm giá và engine trả E_RATE_PROMOTION_INVALID (map 422)', async () => {
  const code = await promotion('H199-OLD', { validFrom: '2026-01-01', validTo: '2026-02-01' });
  const facts = await loadWithCodes([code], 'WEB');
  // Loader ánh xạ đúng hai cột ngày: `valid_to` bao gồm cả ngày nên cận trên là nửa đêm ngày kế.
  expect(facts.promotions.map((promotion) => promotion.code)).toEqual([code]);
  expect(facts.promotions[0]!).toMatchObject({
    validFrom: Date.parse('2026-01-01T00:00:00.000Z'),
    validTo: Date.parse('2026-02-02T00:00:00.000Z'),
  });
  const priced = quotePrice({ ...facts, channelCode: 'WEB' });
  expect(priced.ok).toBe(false);
  if (!priced.ok) expect(priced.error.code).toBe('E_RATE_PROMOTION_INVALID');
});
