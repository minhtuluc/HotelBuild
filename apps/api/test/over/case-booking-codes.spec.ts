/**
 * HB-243 (yêu cầu frontend #2) — ca quá tải trả kèm `affectedBookingCodes` (mã `PH-…`) theo đúng thứ tự
 * `affectedBookingIds`, để SCR-43/44/45 hiển thị mã người đọc được thay vì UUID.
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import { overbookingCaseSummarySchema } from '@pinehill/contracts';
import {
  CASES_ROUTE,
  D,
  clock,
  cohortOf,
  http,
  propertyId,
  rawCases,
  rows,
  seedCase,
  tokenFor,
  typeId,
} from './detection-helpers/index.js';

test('HB243_case_list_and_detail_return_booking_codes_in_affected_order', async () => {
  const cohort = await cohortOf(D);
  const caseId = await seedCase({
    propertyId,
    date: D,
    roomTypeId: typeId,
    shortageCount: 1,
    detectedAt: new Date(clock.value),
  });
  const manager = await tokenFor('MANAGER');
  const expected = String(
    (await rows('SELECT code FROM bookings WHERE id=$1', [cohort.weak]))[0]!.code,
  );

  const list = await rawCases(manager, { propertyId });
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  // `meta` của danh sách ca có `overdueCount`/`scan` riêng ⇒ chỉ parse `data` theo hợp đồng.
  const listed = z
    .object({ data: z.array(overbookingCaseSummarySchema) })
    .parse(list.body)
    .data.find((item) => item.id === caseId);
  expect(listed?.affectedBookingIds).toEqual([cohort.weak]);
  expect(listed?.affectedBookingCodes).toEqual([expected]);
  expect(expected).toMatch(/^PH-/);

  const detail = await http()
    .get(`${CASES_ROUTE}/${caseId}`)
    .set('Authorization', `Bearer ${manager}`);
  expect(detail.status).toBe(200);
  expect(overbookingCaseSummarySchema.parse(detail.body).affectedBookingCodes).toEqual([expected]);
});
