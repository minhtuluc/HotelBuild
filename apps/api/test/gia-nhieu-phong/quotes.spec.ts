/**
 * HB-205 AC5 — `POST /quotes` với `roomCount` 1/2/3 trả tổng N đơn vị bán (F7-QA-03; QĐ-06 mục 1):
 * `nights[].nightlyPrice` giữ giá MỘT đơn vị, `subtotal`/`total`/`depositAmount` là tổng N đơn vị.
 */
import { expect, test } from 'vitest';
import { quoteSchema } from '@pinehill/contracts';
import { quoteRequest, quoteBody } from '../quotes/requests.js';
import '../quotes/fixture.js';

async function quoteOf(roomCount: number) {
  const response = await quoteRequest(quoteBody({ roomCount }));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return quoteSchema.parse(response.body);
}

test('AC5: roomCount 1/2/3 ⇒ subtotal, total và cọc tăng đúng bội số, giá đêm giữ nguyên', async () => {
  const one = await quoteOf(1);
  for (const units of [2, 3]) {
    const many = await quoteOf(units);
    expect(many.nights.map((night) => night.nightlyPrice)).toEqual(
      one.nights.map((night) => night.nightlyPrice),
    );
    expect(many.subtotal).toBe(one.subtotal * units);
    expect(many.total).toBe(one.total * units);
    expect(many.depositPercent).toBe(one.depositPercent);
    expect(many.depositAmount).toBe(
      Math.ceil((many.total * many.depositPercent) / 100 / 1000) * 1000,
    );
    expect(many.engineVersion).toBe('pricing-1.1.0');
  }
});

test('AC4 (hồi quy): roomCount 1 giữ đúng số vàng của ca báo giá một phòng', async () => {
  const one = await quoteOf(1);
  expect(one.total).toBe(one.subtotal - Number(one.discountAmount));
  expect(one.total % 1000).toBe(0);
});
