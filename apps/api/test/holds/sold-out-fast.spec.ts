/**
 * HB-225 (TD-17): `POST /holds` với kỳ **đã hết chỗ** phải trả `409 E_INV_NO_AVAILABILITY` mà không xếp
 * hàng trên khoá `properties` của ADR-014.
 *
 * Trước đây mỗi lệnh thua giữ một connection để chờ khoá rồi mới kiểm tồn. AC4 HB-076 có 200 lệnh giành
 * một đơn vị cuối; trên CI chậm, hàng đợi khoá vượt `timeout` 10 giây của transaction ⇒ 500, client thử
 * lại ⇒ sụp đổ không tự hồi phục.
 *
 * Kỳ còn chỗ thì vẫn phải chờ khoá, để kiểm tồn sau khoá vẫn là nguồn quyết định duy nhất cho lệnh thắng.
 */
import { afterEach, expect, test } from 'vitest';
import pg from 'pg';
import { errorBodySchema } from '@pinehill/contracts';
import { block } from '../room-blocks/inventory-seed.js';
import { databaseUrl } from '../idempotency/database.js';
import { holdBody, holdRequest, issueQuote, propertyId, room2Id, roomId, stay } from './fixture.js';

let locker: pg.Client | undefined;

/** Giữ khoá hàng `properties` ở một phiên khác, như một lệnh giữ chỗ đang chạy dở. */
async function holdPropertyLock(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT id FROM properties WHERE id=$1 FOR UPDATE', [propertyId]);
  locker = client;
  return client;
}

afterEach(async () => {
  if (locker !== undefined) {
    await locker.query('ROLLBACK').catch(() => undefined);
    await locker.end();
    locker = undefined;
  }
});

test('HB225_sold_out_hold_answers_409_without_waiting_for_the_property_lock', async () => {
  const quote = await issueQuote();
  await block(roomId, stay.checkIn, stay.checkOut);
  await block(room2Id, stay.checkIn, stay.checkOut);
  await holdPropertyLock();

  const started = Date.now();
  const response = await holdRequest({ ...holdBody(), quoteId: quote.quoteId });
  const elapsed = Date.now() - started;

  expect(response.status).toBe(409);
  expect(errorBodySchema.parse(response.body).code).toBe('E_INV_NO_AVAILABILITY');
  // Khoá vẫn bị giữ suốt lệnh: phản hồi nhanh chứng tỏ lệnh không chờ khoá (transaction timeout 10 s).
  expect(elapsed).toBeLessThan(3000);
});

test('HB225_available_hold_still_waits_for_the_lock_before_deciding', async () => {
  const quote = await issueQuote();
  const client = await holdPropertyLock();
  const RELEASE_AFTER = 1000;
  const release = new Promise<void>((resolve) => {
    setTimeout(() => {
      void client.query('ROLLBACK').then(() => resolve());
    }, RELEASE_AFTER);
  });

  const started = Date.now();
  const response = await holdRequest({ ...holdBody(), quoteId: quote.quoteId });
  const elapsed = Date.now() - started;
  await release;

  expect(response.status).toBe(201);
  expect(elapsed).toBeGreaterThanOrEqual(RELEASE_AFTER - 50);
});
