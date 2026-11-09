/**
 * HB-228 — lệnh `POST /holds` đồng thời **nhiều hơn** kích thước pool Prisma vẫn phải có phán quyết
 * nghiệp vụ (1 thắng, còn lại 409) chứ không treo tới `timeout` 10 giây rồi 500.
 *
 * Gốc lỗi: `@Idempotent` mở transaction (giữ một connection), rồi handler lại gọi `holdCaller(this.db)`
 * để kiểm phiên (TD-59), tức xin thêm một connection. Với N lệnh ≥ pool, mọi connection bị transaction
 * giữ và mọi lệnh chờ connection thứ hai ⇒ bế tắc pool. Đây là cơ chế đo được ở TD-79 và AC4 HB-076.
 * Lượt k6 HB-184 với pool mặc định (17) cũng tái hiện được bằng 20 VU.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { errorBodySchema } from '@pinehill/contracts';
import { block } from '../room-blocks/inventory-seed.js';
import {
  guestToken,
  holdBody,
  holdRequest,
  http,
  issueQuote,
  propertyId,
  room2Id,
  stay,
  typeId,
  useConnectionLimit,
} from './fixture.js';

const POOL = 4;
const CONCURRENT = 12;
useConnectionLimit(POOL);

test('HB228_concurrent_holds_beyond_pool_size_get_business_answers_not_timeouts', async () => {
  await block(room2Id, stay.checkIn, stay.checkOut);
  const quote = await issueQuote();
  const body = { ...holdBody(), quoteId: quote.quoteId };

  const started = Date.now();
  const responses = await Promise.all(Array.from({ length: CONCURRENT }, () => holdRequest(body)));
  const elapsed = Date.now() - started;

  const statuses = responses.map((response) => response.status).sort();
  expect(
    statuses.filter((status) => status >= 500),
    JSON.stringify(statuses),
  ).toHaveLength(0);
  expect(statuses.filter((status) => status === 201)).toHaveLength(1);
  for (const response of responses.filter((r) => r.status !== 201)) {
    expect(response.status).toBe(409);
    expect(['E_INV_NO_AVAILABILITY', 'E_INV_ROOM_TAKEN']).toContain(
      errorBodySchema.parse(response.body).code,
    );
  }
  // Bế tắc pool chỉ được gỡ bởi `timeout` 10 giây của transaction.
  expect(elapsed).toBeLessThan(8000);
}, 60_000);

test('HB228_concurrent_quotes_beyond_pool_size_do_not_deadlock', async () => {
  const started = Date.now();
  const responses = await Promise.all(
    Array.from({ length: CONCURRENT }, () =>
      http()
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${guestToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          propertyId,
          roomTypeId: typeId,
          channelCode: 'WEB',
          ratePlanCode: 'FLEX7',
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          adults: 2,
          children: 0,
          roomCount: 1,
        }),
    ),
  );
  const statuses = responses.map((response) => response.status);
  expect(
    statuses.filter((status) => status !== 201),
    JSON.stringify(statuses),
  ).toHaveLength(0);
  expect(Date.now() - started).toBeLessThan(8000);
}, 60_000);
