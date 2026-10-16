/**
 * HB-074 — tiêu thụ quote (điểm nối cho HB-076 giữ chỗ và HB-077 đặt phòng, trực tiếp kiểm trên
 * `RateQuoteService.consume` vì hai route đó thuộc ticket khác; mã và trạng thái HTTP được khẳng định
 * trên `AppError` — đúng thứ filter toàn cục gửi ra).
 *
 * AC2: dùng quote khác principal/kênh/kỳ ⇒ `409 E_RATE_QUOTE_MISMATCH`; mất cache hoặc hết hạn ⇒
 * `410 E_RATE_QUOTE_EXPIRED` (api.md §3.1: quá hạn thì báo giá mới, không tự tăng giá).
 * AC3: đổi cấu hình giá **không** làm đổi quote còn hạn.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { Redis } from 'ioredis';
import { quoteSchema } from '@pinehill/contracts';
import { clock, dlxTypeId, nights, quoteRedis, quoteService, rows } from './fixture.js';
import { db, propertyId, secondUserId } from '../idempotency/database.js';
import type { Principal } from '../../src/common/idempotency/request.js';
import { RateQuoteService } from '../../src/modules/rate/quotes/service.js';
import {
  QUOTE_KEY_PREFIX,
  RateQuoteStore,
  storedQuoteSchema,
} from '../../src/modules/rate/quotes/store.js';
import { quoteBody, quoteRequest } from './requests.js';

interface Issued {
  quoteId: string;
  total: number;
  principal: Principal;
  body: Record<string, unknown>;
}

/** Phát hành quote qua HTTP rồi đọc lại chủ thể đã gắn từ bản ghi (tránh đoán IP trong test). */
async function issue(body: Record<string, unknown> = quoteBody()): Promise<Issued> {
  const response = await quoteRequest(body);
  expect(response.status).toBe(201);
  const quote = quoteSchema.parse(response.body);
  const stored = storedQuoteSchema.parse(
    JSON.parse((await quoteRedis().get(`${QUOTE_KEY_PREFIX}${quote.quoteId}`))!),
  );
  const separator = stored.principal.indexOf(':');
  const principalType = stored.principal.slice(0, separator);
  const principalId = stored.principal.slice(separator + 1);
  if ((principalType !== 'USER' && principalType !== 'ANONYMOUS') || principalId.length === 0)
    throw new Error(`Bản ghi quote có principal lạ: ${stored.principal}`);
  return {
    quoteId: quote.quoteId,
    total: quote.total,
    principal: { type: principalType, id: principalId },
    body,
  };
}

const consumeBody = (issued: Issued, overrides: object = {}) => ({
  ...issued.body,
  ...overrides,
  quoteId: issued.quoteId,
});

test('AC2: đúng chủ thể + đúng đầu vào trả nguyên bản ghi đã lưu', async () => {
  const issued = await issue();
  const resolved = await quoteService().consume(
    issued.quoteId,
    issued.principal,
    consumeBody(issued),
  );
  expect(resolved.quote.total).toBe(issued.total);
  expect(resolved.quote.quoteId).toBe(issued.quoteId);
});

test('AC2: dùng quote của principal khác ⇒ 409 `E_RATE_QUOTE_MISMATCH`', async () => {
  const issued = await issue();
  const other: Principal = { type: 'USER', id: secondUserId };
  await expect(
    quoteService().consume(issued.quoteId, other, consumeBody(issued)),
  ).rejects.toMatchObject({ status: 409, code: 'E_RATE_QUOTE_MISMATCH' });
});

test.each([
  ['kênh WEB → OTA_BOOKING', { channelCode: 'OTA_BOOKING' }],
  ['kỳ khác', { checkIn: '2026-05-01', checkOut: '2026-05-04' }],
  ['roomCount khác', { roomCount: 2 }],
  ['adults khác', { adults: 1 }],
  ['children/childAges khác', { children: 1, childAges: [3] }],
  ['promotionCodes khác', { promotionCodes: ['HB074-NEW'] }],
] as const)(
  'AC2: đổi %s trên lệnh tiêu thụ ⇒ 409 `E_RATE_QUOTE_MISMATCH`',
  async (_label, overrides) => {
    const issued = await issue();
    await expect(
      quoteService().consume(issued.quoteId, issued.principal, consumeBody(issued, overrides)),
    ).rejects.toMatchObject({ status: 409, code: 'E_RATE_QUOTE_MISMATCH' });
  },
);

test('AC2: quoteId lạ (mất cache) ⇒ 410 `E_RATE_QUOTE_EXPIRED`', async () => {
  const issued = await issue();
  await expect(
    quoteService().consume(randomUUID(), issued.principal, consumeBody(issued)),
  ).rejects.toMatchObject({ status: 410, code: 'E_RATE_QUOTE_EXPIRED' });
});

test('AC2: quá 15 phút ⇒ 410 dù khoá Redis còn sống (hạn kiểm bằng `expiresAt` trong bản ghi)', async () => {
  const issued = await issue();
  clock.value += 901_000;
  const ttlMs = await quoteRedis().pttl(`${QUOTE_KEY_PREFIX}${issued.quoteId}`);
  expect(ttlMs).toBeGreaterThan(0);
  await expect(
    quoteService().consume(issued.quoteId, issued.principal, consumeBody(issued)),
  ).rejects.toMatchObject({ status: 410, code: 'E_RATE_QUOTE_EXPIRED' });
});

test('AC3: đổi cấu hình giá không làm đổi quote còn hạn; báo giá mới phản ánh giá mới', async () => {
  const before = await issue(quoteBody({ channelCode: 'WEB' }));
  for (const date of nights)
    await rows(
      "INSERT INTO rate_calendars(room_type_id,property_id,date,price,source,priority,reason) VALUES($1,$2,$3,2000000,'OVERRIDE',100,'HB-074 AC3: đổi cấu hình giá')",
      [dlxTypeId, propertyId, date],
    );
  const after = quoteSchema.parse((await quoteRequest(quoteBody({ channelCode: 'WEB' }))).body);
  expect(after.total).not.toBe(before.total);
  const resolved = await quoteService().consume(
    before.quoteId,
    before.principal,
    consumeBody(before),
  );
  expect(resolved.quote.total).toBe(before.total);
});

test('Redis lỗi ⇒ 503 `E_GEN_SERVICE_UNAVAILABLE`: không phát hành và không tiêu thụ quote mù', async () => {
  const issued = await issue();
  const dead = new Redis('redis://127.0.0.1:1/0', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  try {
    dead.on('error', () => {
      // Lỗi kết nối cố ý: service phải đổi thành 503, không nổ tung tiến trình test.
    });
    const service = new RateQuoteService(
      db,
      new RateQuoteStore(dead),
      { generate: randomUUID },
      clock,
    );
    await expect(
      service.consume(issued.quoteId, issued.principal, consumeBody(issued)),
    ).rejects.toMatchObject({ status: 503, code: 'E_GEN_SERVICE_UNAVAILABLE' });
    await expect(service.create(db, issued.principal, issued.body)).rejects.toMatchObject({
      status: 503,
      code: 'E_GEN_SERVICE_UNAVAILABLE',
    });
  } finally {
    dead.disconnect();
  }
});
