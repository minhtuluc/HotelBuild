/**
 * HB-056 — tích hợp thật `POST /api/v1/quotes/multi-channel` (UC-RATE-05, BR-RATE-07,08,09,17).
 *
 * AC3 khẳng định giá **khớp từng VND** với gọi engine trực tiếp trên **cùng bộ dữ kiện** nạp qua loader,
 * và ca 2 `dong-gia.md` §5 (OTA_BOOKING 8.112.000). AC4 khẳng định endpoint chỉ đọc.
 */
import { z } from 'zod';
import { expect, test } from 'vitest';
import { channelCodeSchema, errorBodySchema, multiChannelQuoteSchema } from '@pinehill/contracts';
import { quotePrice } from '@pinehill/domain/pricing';
import { http, login } from '../../room-blocks/http-fixture.js';
import { otherTypeId } from '../../room-blocks/inventory-seed.js';
import { db, dlxTypeId, propertyId, rows, stay } from './seed.js';
import { loadPricingFacts } from '../../../src/modules/rate/pricing-facts/loader.js';

const post = (token: string, body: object) =>
  http().post('/api/v1/quotes/multi-channel').set('Authorization', `Bearer ${token}`).send(body);

async function factsFor(roomTypeId = dlxTypeId, promotionCodes?: readonly string[]) {
  return db.$transaction((tx) =>
    loadPricingFacts(tx, {
      roomTypeId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      ...(promotionCodes === undefined ? {} : { promotionCodes }),
    }),
  );
}

test('ca 2 dong-gia §5: MANAGER thấy OTA_BOOKING đúng 8.112.000 và hoa hồng 1.460.160', async () => {
  const token = await login('MANAGER');
  const response = await post(token, {
    roomTypeId: dlxTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    channelCodes: ['OTA_BOOKING'],
  });
  expect(response.status).toBe(200);
  const quote = multiChannelQuoteSchema.parse(response.body);
  expect(quote.options).toHaveLength(1);
  expect(quote.options[0]).toMatchObject({
    channelCode: 'OTA_BOOKING',
    nightlyFrom: 2_704_000,
    totalFrom: 8_112_000,
    grossTotal: 8_112_000,
    commissionPct: 18,
    commissionAmount: 1_460_160,
    netTotal: 6_651_840,
  });
});

test('AC3: mọi kênh khớp từng VND với engine gọi trực tiếp trên cùng dữ kiện loader', async () => {
  const token = await login('MANAGER');
  const channels = [...channelCodeSchema.options];
  const response = await post(token, {
    roomTypeId: dlxTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    channelCodes: channels,
  });
  expect(response.status).toBe(200);
  const quote = multiChannelQuoteSchema.parse(response.body);
  const facts = await factsFor();
  expect(quote.options.map((option) => option.channelCode)).toEqual(channels);
  for (const option of quote.options) {
    const result = quotePrice({ ...facts, channelCode: option.channelCode });
    expect(result.ok).toBe(true);
    if (!result.ok) continue;
    const engine = result.value;
    expect(option.totalFrom).toBe(engine.total);
    expect(option.grossTotal).toBe(engine.total);
    expect(option.nightlyFrom).toBe(Math.min(...engine.nights.map((night) => night.nightlyPrice)));
    expect(option.warnings).toEqual([...engine.warnings]);
    expect(option.netTotal).toBe(option.grossTotal! - option.commissionAmount!);
  }
});

test('BR-RATE-14: mã khuyến mãi không có trong danh mục là 422 E_RATE_PROMO_INVALID, mã hợp lệ vẫn giảm giá', async () => {
  // Danh mục thật trong CSDL: một mã đang bán và một mã đã tắt.
  await rows(
    "INSERT INTO promotions(code,name,type,value,min_nights,valid_from,valid_to,stackable,status) VALUES('H074-ON','Synthetic HB074 bật','PERCENT',10,1,'2026-01-01','2027-12-31',false,'ACTIVE'),('H074-OFF','Synthetic HB074 tắt','PERCENT',10,1,'2026-01-01','2027-12-31',false,'INACTIVE')",
  );

  // (1) Mã không tồn tại trong danh mục ⇒ lỗi người gọi, đúng mã/status của catalogue (api.md §5).
  await expect(factsFor(dlxTypeId, ['H074-KHONG-CO'])).rejects.toMatchObject({
    status: 422,
    code: 'E_RATE_PROMO_INVALID',
  });

  // (2) Có trong danh mục nhưng đang tắt: đặc tả chỉ buộc từ chối mã không hợp lệ/hết hạn/hết lượt nên
  // mã đang tắt chỉ đơn giản không được áp (cách đọc hẹp — HB-198 PR ghi rõ).
  const off = await factsFor(dlxTypeId, ['H074-OFF']);
  expect(off.promotions).toEqual([]);

  // (3) Mã hợp lệ: dữ kiện mang mã và engine vẫn giảm giá đúng như hiện nay.
  const plain = quotePrice({ ...(await factsFor()), channelCode: 'WEB' });
  const withPromo = await factsFor(dlxTypeId, ['H074-ON']);
  expect(withPromo.promotions.map((promotion) => promotion.code)).toEqual(['H074-ON']);
  const discounted = quotePrice({ ...withPromo, channelCode: 'WEB' });
  expect(plain.ok && discounted.ok).toBe(true);
  if (plain.ok && discounted.ok) {
    expect(discounted.value.appliedPromotions).toEqual(['H074-ON']);
    expect(discounted.value.total).toBeLessThan(plain.value.total);
    // BR-RATE-10: PERCENT áp **một lần trên tổng tạm tính**; phần giảm là phân số chính xác, còn tổng
    // chốt bị làm tròn **xuống** bội số 1.000 (BR-RATE-01 bước cuối) nên chênh lệch không đúng bằng 10%.
    const discount = discounted.value.discountAmount;
    expect(Number(discount.numerator) / Number(discount.denominator)).toBe(
      plain.value.subtotal / 10,
    );
    expect(discounted.value.total).toBe(
      Math.floor((plain.value.subtotal - plain.value.subtotal / 10) / 1000) * 1000,
    );
  }
});

test('AC2/HB-062 AC4: bỏ trống channelCodes thì mặc định so cả 7 kênh', async () => {
  const token = await login('MANAGER');
  const response = await post(token, {
    roomTypeId: dlxTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  expect(response.status).toBe(200);
  expect(multiChannelQuoteSchema.parse(response.body).options.map((o) => o.channelCode)).toEqual([
    ...channelCodeSchema.options,
  ]);
});

test('MANAGER+ trong phạm vi: FRONT_DESK 403, không xác thực 401, loại phòng ngoài cơ sở 403', async () => {
  const frontDesk = await login('FRONT_DESK');
  expect(
    (
      await post(frontDesk, {
        roomTypeId: dlxTypeId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        channelCodes: ['WEB'],
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await http()
        .post('/api/v1/quotes/multi-channel')
        .send({ roomTypeId: dlxTypeId, checkIn: stay.checkIn, checkOut: stay.checkOut })
    ).status,
  ).toBe(401);
  const manager = await login('MANAGER');
  const foreign = await post(manager, {
    roomTypeId: otherTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    channelCodes: ['WEB'],
  });
  expect(foreign.status).toBe(403);
  expect(errorBodySchema.parse(foreign.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
});

test('AC4: chỉ đọc — không tạo booking/price snapshot, kỳ sai bị 400, loại phòng lạ 404', async () => {
  const token = await login('MANAGER');
  const before = (
    await rows(
      'SELECT (SELECT count(*) FROM price_snapshots) AS snapshots,(SELECT count(*) FROM bookings) AS bookings',
    )
  )[0]!;
  const ok = await post(token, {
    roomTypeId: dlxTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    channelCodes: ['WEB'],
  });
  expect(ok.status).toBe(200);
  expect(ok.body).not.toHaveProperty('quoteId');
  const after = (
    await rows(
      'SELECT (SELECT count(*) FROM price_snapshots) AS snapshots,(SELECT count(*) FROM bookings) AS bookings',
    )
  )[0]!;
  expect(after).toEqual(before);
  const reversed = await post(token, {
    roomTypeId: dlxTypeId,
    checkIn: stay.checkOut,
    checkOut: stay.checkIn,
    channelCodes: ['WEB'],
  });
  expect(reversed.status).toBe(400);
  const unknown = await post(token, {
    roomTypeId: '00000000-0000-4000-8000-000000000000',
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    channelCodes: ['WEB'],
  });
  expect(unknown.status).toBe(404);
});

test('kỳ công suất tươi: đổi mùa thay đổi giá nhưng không lệch khỏi engine', async () => {
  const token = await login('MANAGER');
  await rows("UPDATE seasons SET multiplier=0.85 WHERE property_id=$1 AND code='SE-REUN'", [
    propertyId,
  ]);
  const response = await post(token, {
    roomTypeId: dlxTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    channelCodes: ['WEB'],
  });
  expect(response.status).toBe(200);
  const parsed = z
    .object({ options: z.array(z.object({ totalFrom: z.number() })) })
    .parse(response.body);
  const facts = await factsFor();
  const result = quotePrice({ ...facts, channelCode: 'WEB' });
  expect(result.ok).toBe(true);
  if (result.ok) expect(parsed.options[0]!.totalFrom).toBe(result.value.total);
});

test('HB-198: hết gói giá ACTIVE thì báo giá đa kênh vẫn 422 (tách khỏi lịch giá)', async () => {
  const token = await login('MANAGER');
  const plans = await rows('SELECT id::text AS id, status FROM rate_plans ORDER BY id');
  try {
    await rows("UPDATE rate_plans SET status='INACTIVE'");
    const response = await post(token, {
      roomTypeId: dlxTypeId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      channelCodes: ['WEB'],
    });
    // Báo giá phải có gói giá: không phân giải được gói ⇒ 422, khác hẳn lịch giá (vẫn 200).
    expect(response.status).toBe(422);
    expect(errorBodySchema.parse(response.body).code).toBe('E_RATE_CONFIGURATION_INVALID');
  } finally {
    for (const plan of plans)
      await rows('UPDATE rate_plans SET status=$1 WHERE id=$2', [plan.status, plan.id]);
  }
});
