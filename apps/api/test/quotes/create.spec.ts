/**
 * HB-074 — tích hợp thật `POST /api/v1/quotes` (UC-RATE-05; BR-RATE-15,17; api.md §3.1, §5, §6.4).
 *
 * AC1: quote bất biến 15 phút — lưu Redis TTL 900 giây **kèm đủ dữ kiện xác minh** (bản ghi ghi rõ
 * `fingerprint`/`principal`/`engineVersion`/`input` + nguyên phản hồi 201); fingerprint = băm đầu vào
 * chuẩn hoá + principal + `engineVersion`.
 * AC4: kết quả **khớp `POST /quotes/multi-channel` từng VND** cho cùng đầu vào.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  channelCodeSchema,
  errorBodySchema,
  multiChannelQuoteSchema,
  quoteSchema,
} from '@pinehill/contracts';
import { quotePrice } from '@pinehill/domain/pricing';
import { login, rows, stay, dlxTypeId, quoteRedis } from './fixture.js';
import { db, propertyId } from '../idempotency/database.js';
import { assertQuoteChannel } from '../../src/modules/rate/quotes/channel-policy.js';
import { loadPricingFacts } from '../../src/modules/rate/pricing-facts/loader.js';
import {
  QUOTE_KEY_PREFIX,
  QUOTE_TTL_SECONDS,
  storedQuoteSchema,
} from '../../src/modules/rate/quotes/store.js';
import { multiChannelRequest, quoteBody, quoteRequest } from './requests.js';

type Channel = (typeof channelCodeSchema.options)[number];
type PrincipalType = 'USER' | 'GUEST' | 'SYSTEM' | 'ANONYMOUS';

/** Chính sách kênh không có đường HTTP cho `SYSTEM`/`GUEST` nên kiểm thẳng trên hàm chính sách. */
function policyError(channelCode: Channel, type: PrincipalType): unknown {
  try {
    assertQuoteChannel(channelCode, { type });
    return null;
  } catch (error) {
    return error;
  }
}

test('AC1: ẩn danh báo được giá WEB 201 kèm TTL 900 giây, khoá và dữ kiện lưu khớp phản hồi', async () => {
  const response = await quoteRequest(quoteBody());
  expect(response.status).toBe(201);
  const quote = quoteSchema.parse(response.body);
  expect(quote.channelCode).toBe('WEB');
  expect(quote.ratePlanCode).toBe('FLEX7');
  expect(quote.currency).toBe('VND');
  expect(quote.nights).toHaveLength(3);
  expect(Date.parse(quote.expiresAt) - Date.parse(quote.quotedAt)).toBe(QUOTE_TTL_SECONDS * 1000);

  const ttlMs = await quoteRedis().pttl(`${QUOTE_KEY_PREFIX}${quote.quoteId}`);
  expect(ttlMs).toBeGreaterThan(0);
  expect(ttlMs).toBeLessThanOrEqual(QUOTE_TTL_SECONDS * 1000);

  const stored = storedQuoteSchema.parse(
    JSON.parse((await quoteRedis().get(`${QUOTE_KEY_PREFIX}${quote.quoteId}`))!),
  );
  // Bản ghi còn dùng được khi chốt: nguyên phản hồi, chủ thể, fingerprint, dữ kiện chuẩn hoá.
  expect(stored.quote).toEqual(quote);
  expect(stored.principal).toMatch(/^ANONYMOUS:.+$/);
  expect(stored.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(stored.engineVersion).toBe(quote.engineVersion);
  expect(stored.input).toMatchObject({
    propertyId,
    roomTypeId: dlxTypeId,
    channelCode: 'WEB',
    ratePlanCode: 'FLEX7',
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: 2,
    children: 0,
    roomCount: 1,
  });
});

test('AC1/BR-RATE-17: cùng đầu vào cho cùng con số (chỉ `quotedAt` được khác), fingerprint ổn định', async () => {
  const first = quoteSchema.parse((await quoteRequest(quoteBody())).body);
  const second = quoteSchema.parse((await quoteRequest(quoteBody())).body);
  expect(first.quoteId).not.toBe(second.quoteId);
  expect(second.total).toBe(first.total);
  expect(second.subtotal).toBe(first.subtotal);
  expect(second.nights.map((night) => night.nightlyPrice)).toEqual(
    first.nights.map((night) => night.nightlyPrice),
  );
  const read = async (quoteId: string) =>
    storedQuoteSchema.parse(JSON.parse((await quoteRedis().get(`${QUOTE_KEY_PREFIX}${quoteId}`))!));
  const [storedFirst, storedSecond] = await Promise.all([
    read(first.quoteId),
    read(second.quoteId),
  ]);
  expect(storedSecond.fingerprint).toBe(storedFirst.fingerprint);
  expect(storedSecond.principal).toBe(storedFirst.principal);
});

test('Idempotency-Key theo hợp đồng F4: thiếu khoá 400, gửi lại cùng khoá phát lại cùng quote', async () => {
  const key = randomUUID();
  expect((await quoteRequest({})).status).toBe(400);
  const first = quoteSchema.parse((await quoteRequest(quoteBody(), { key })).body);
  const replayed = await quoteRequest(quoteBody(), { key });
  expect(replayed.status).toBe(201);
  expect(replayed.headers['idempotency-replayed']).toBe('true');
  expect(quoteSchema.parse(replayed.body).quoteId).toBe(first.quoteId);
});

test('Cùng đầu vào giá không đổi theo người yêu cầu; chỉ `principal` trong fingerprint khác', async () => {
  const token = await login('MANAGER');
  const anonymous = quoteSchema.parse((await quoteRequest(quoteBody())).body);
  const staff = quoteSchema.parse((await quoteRequest(quoteBody(), { token })).body);
  expect(staff.total).toBe(anonymous.total);
  const read = async (quoteId: string) =>
    storedQuoteSchema.parse(JSON.parse((await quoteRedis().get(`${QUOTE_KEY_PREFIX}${quoteId}`))!));
  const storedStaff = await read(staff.quoteId);
  expect(storedStaff.principal).toMatch(/^USER:[0-9a-f-]{36}$/);
  expect(storedStaff.fingerprint).not.toBe((await read(anonymous.quoteId)).fingerprint);
});

test('AC4: kênh `/quotes` phục vụ khớp `POST /quotes/multi-channel` từng VND; kênh OTA khớp engine', async () => {
  const token = await login('MANAGER');
  const channels = [...channelCodeSchema.options];
  const multi = await multiChannelRequest(token, {
    roomTypeId: dlxTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    channelCodes: channels,
  });
  expect(multi.status).toBe(200);
  const compared = multiChannelQuoteSchema.parse(multi.body);
  expect(compared.options.map((option) => option.channelCode)).toEqual(channels);
  // api.md §1.4: bearer chỉ được WEB/PHONE/WALKIN ⇒ đối chiếu từng VND trên đúng ba kênh đó.
  for (const channelCode of ['WEB', 'PHONE', 'WALKIN'] as const) {
    const response = await quoteRequest(quoteBody({ channelCode }), { token });
    expect(response.status).toBe(201);
    const single = quoteSchema.parse(response.body);
    const option = compared.options.find((o) => o.channelCode === channelCode)!;
    expect(option.totalFrom).toBe(single.total);
    expect(option.grossTotal).toBe(single.total);
    expect(option.nightlyFrom).toBe(Math.min(...single.nights.map((night) => night.nightlyPrice)));
    expect(option.warnings).toEqual([...single.warnings]);
  }
  // Kênh OTA/đại lý đóng với bearer: số của `/quotes/multi-channel` đối chiếu với engine trên **cùng dữ kiện**.
  const facts = await db.$transaction((tx) =>
    loadPricingFacts(tx, {
      roomTypeId: dlxTypeId,
      propertyId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
    }),
  );
  for (const option of compared.options) {
    const result = quotePrice({ ...facts, channelCode: option.channelCode });
    expect(result.ok).toBe(true);
    if (!result.ok) continue;
    expect(option.totalFrom).toBe(result.value.total);
    expect(option.nightlyFrom).toBe(
      Math.min(...result.value.nights.map((night) => night.nightlyPrice)),
    );
  }
  // Số vàng `dong-gia.md` §5 ca 2 (DLX 30/04–03/05, SE-REUN 1,80, công suất 82%, LOS 3 đêm → 0,95).
  expect(compared.options.find((option) => option.channelCode === 'OTA_BOOKING')).toMatchObject({
    nightlyFrom: 2_704_000,
    totalFrom: 8_112_000,
  });
  for (const channelCode of ['AGENCY', 'OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'] as const) {
    const refused = await quoteRequest(quoteBody({ channelCode }), { token });
    expect(refused.status).toBe(403);
    expect(errorBodySchema.parse(refused.body).code).toBe('E_RBAC_FORBIDDEN');
  }
});

test('Chính sách kênh api.md §1.4: WEB mọi chủ thể; PHONE/WALKIN chỉ nhân viên; OTA/đại lý chỉ adapter', async () => {
  expect((await quoteRequest(quoteBody())).status).toBe(201);
  for (const channelCode of ['PHONE', 'WALKIN', 'AGENCY', 'OTA_BOOKING'] as const) {
    const refused = await quoteRequest(quoteBody({ channelCode }));
    expect(refused.status).toBe(403);
    expect(errorBodySchema.parse(refused.body).code).toBe('E_RBAC_FORBIDDEN');
  }
  const token = await login('MANAGER');
  for (const channelCode of ['WEB', 'PHONE', 'WALKIN'] as const) {
    const allowed = await quoteRequest(quoteBody({ channelCode }), { token });
    expect(allowed.status).toBe(201);
    expect(quoteSchema.parse(allowed.body).channelCode).toBe(channelCode);
  }
  for (const channelCode of ['AGENCY', 'OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'] as const)
    expect((await quoteRequest(quoteBody({ channelCode }), { token })).status).toBe(403);
  // Ma trận đầy đủ cho hai chủ thể không có đường HTTP ở HB-074 (phiên khách, adapter đã xác thực).
  for (const channelCode of channelCodeSchema.options) {
    expect(policyError(channelCode, 'SYSTEM')).toBeNull();
    for (const type of ['GUEST', 'ANONYMOUS'] as const) {
      const error = policyError(channelCode, type);
      if (channelCode === 'WEB') expect(error).toBeNull();
      else expect(error).toMatchObject({ status: 403, code: 'E_RBAC_FORBIDDEN' });
    }
  }
});

test('BR-BOOK-05/api.md §5: `adults + children` mới là số khách so với sức chứa', async () => {
  const token = await login('MANAGER');
  const over = await quoteRequest(quoteBody({ adults: 4 }), { token });
  expect(over.status).toBe(422);
  expect(errorBodySchema.parse(over.body).code).toBe('E_BOOK_OVER_CAPACITY');
  const withChildren = await quoteRequest(
    quoteBody({ adults: 2, children: 2, childAges: [5, 7] }),
    { token },
  );
  expect(withChildren.status).toBe(422);
  expect(errorBodySchema.parse(withChildren.body).code).toBe('E_BOOK_OVER_CAPACITY');
  const exactlyFull = await quoteRequest(quoteBody({ adults: 2, children: 1, childAges: [7] }), {
    token,
  });
  expect(exactlyFull.status).toBe(201);
});

test('BR-BOOK-05/api.md §6.4: có trẻ em mà thiếu tuổi ⇒ 400 `E_BOOK_MISSING_FIELD`; sai số phần tử ⇒ `E_GEN_VALIDATION_FAILED`', async () => {
  const missing = await quoteRequest(quoteBody({ children: 1 }));
  expect(missing.status).toBe(400);
  expect(errorBodySchema.parse(missing.body)).toMatchObject({
    code: 'E_BOOK_MISSING_FIELD',
    details: [{ field: 'childAges', issue: 'required' }],
  });
  const mismatched = await quoteRequest(quoteBody({ children: 2, childAges: [5] }));
  expect(mismatched.status).toBe(400);
  expect(errorBodySchema.parse(mismatched.body).code).toBe('E_GEN_VALIDATION_FAILED');
  const complete = await quoteRequest(quoteBody({ children: 1, childAges: [7] }));
  expect(complete.status).toBe(201);
  const stored = storedQuoteSchema.parse(
    JSON.parse(
      (await quoteRedis().get(`${QUOTE_KEY_PREFIX}${quoteSchema.parse(complete.body).quoteId}`))!,
    ),
  );
  expect(stored.input.childAges).toEqual([7]);
});

test('api.md §5: thiếu trường bắt buộc ⇒ 400 `E_BOOK_MISSING_FIELD` kèm `details[].field`', async () => {
  const empty = await quoteRequest({});
  expect(empty.status).toBe(400);
  const body = errorBodySchema.parse(empty.body);
  expect(body.code).toBe('E_BOOK_MISSING_FIELD');
  expect(body.details?.map((detail) => detail.field)).toEqual([
    'propertyId',
    'roomTypeId',
    'channelCode',
    'ratePlanCode',
    'checkIn',
    'checkOut',
    'adults',
    'children',
    'roomCount',
  ]);
  const partial = await quoteRequest({ ...quoteBody(), roomTypeId: undefined });
  expect(partial.status).toBe(400);
  expect(errorBodySchema.parse(partial.body)).toMatchObject({
    code: 'E_BOOK_MISSING_FIELD',
    details: [{ field: 'roomTypeId', issue: 'required' }],
  });
});

test('Lệnh sai kiểu/giá trị: đảo ngày 400, loại phòng lạ 404, kênh lạ 400, `adults` kiểu sai 400', async () => {
  const reversed = await quoteRequest(
    quoteBody({ checkIn: stay.checkOut, checkOut: stay.checkIn }),
  );
  expect(reversed.status).toBe(400);
  expect(errorBodySchema.parse(reversed.body).code).toBe('E_GEN_VALIDATION_FAILED');
  const unknown = await quoteRequest(
    quoteBody({ roomTypeId: '00000000-0000-4000-8000-000000000000' }),
  );
  expect(unknown.status).toBe(404);
  const unknownChannel = await quoteRequest(quoteBody({ channelCode: 'OTA_NOPE' }));
  expect(unknownChannel.status).toBe(400);
  expect(errorBodySchema.parse(unknownChannel.body).code).toBe('E_GEN_VALIDATION_FAILED');
  const wrongType = await quoteRequest(quoteBody({ adults: '2' }));
  expect(wrongType.status).toBe(400);
  expect(errorBodySchema.parse(wrongType.body).code).toBe('E_GEN_VALIDATION_FAILED');
});

test('BR-BOOK-03/api.md §5: dưới `minNights` và trên `maxNights` đều 422 `E_BOOK_MIN_NIGHTS`', async () => {
  await rows(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id,min_nights,max_nights) SELECT 'SAVER3','Synthetic SAVER3',50,id,3,5 FROM cancellation_policies WHERE code='H034'",
  );
  const below = await quoteRequest(quoteBody({ ratePlanCode: 'SAVER3', checkOut: '2026-05-02' }));
  expect(below.status).toBe(422);
  expect(errorBodySchema.parse(below.body).code).toBe('E_BOOK_MIN_NIGHTS');
  const above = await quoteRequest(
    quoteBody({ ratePlanCode: 'SAVER3', checkIn: '2026-04-28', checkOut: '2026-05-04' }),
  );
  expect(above.status).toBe(422);
  expect(errorBodySchema.parse(above.body).code).toBe('E_BOOK_MIN_NIGHTS');
});

test('Cọc nhất quán với phần trăm đã báo; tỷ lệ cọc không nguyên ⇒ 422 `E_RATE_CONFIGURATION_INVALID`', async () => {
  const quote = quoteSchema.parse((await quoteRequest(quoteBody())).body);
  expect(quote.depositPercent).toBe(30);
  expect(quote.depositAmount).toBe(
    Math.ceil((quote.total * quote.depositPercent) / 100 / 1000) * 1000,
  );
  await rows("UPDATE rate_plans SET deposit_percent=12.50 WHERE code='FLEX7'");
  const fractional = await quoteRequest(quoteBody());
  expect(fractional.status).toBe(422);
  expect(errorBodySchema.parse(fractional.body).code).toBe('E_RATE_CONFIGURATION_INVALID');
  await rows("UPDATE rate_plans SET deposit_percent=30 WHERE code='FLEX7'");
});

test('Khuyến mãi hết lượt ⇒ 422 `E_RATE_PROMO_INVALID`; mã không có trong danh mục cũng bị từ chối', async () => {
  await rows(
    "INSERT INTO promotions(code,name,type,value,stackable,valid_from,valid_to,max_uses,used_count) VALUES('HB074-USED','Synthetic','PERCENT',10,true,'2026-01-01','2026-12-31',1,1)",
  );
  const exhausted = await quoteRequest(quoteBody({ promotionCodes: ['HB074-USED'] }));
  expect(exhausted.status).toBe(422);
  expect(errorBodySchema.parse(exhausted.body).code).toBe('E_RATE_PROMO_INVALID');
  // HB-198 (loader `pricing-facts`) từ chối mã không tồn tại — HB-074 chỉ chuyển mã xuống loader.
  const unknown = await quoteRequest(quoteBody({ promotionCodes: ['HB074-NOPE'] }));
  expect(unknown.status).toBe(422);
  expect(errorBodySchema.parse(unknown.body).code).toBe('E_RATE_PROMO_INVALID');
});
