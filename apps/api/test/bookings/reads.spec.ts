/**
 * HB-077 — AC4: `GET /bookings`, `GET /bookings/{bookingId}` và phân quyền nhân viên trên app thật +
 * PostgreSQL 16 + Redis (DB `/4`).
 *
 * Khách chỉ thấy booking của mình; nhân viên lọc theo **phạm vi cơ sở** (BR-RBAC-02/03);
 * HOUSEKEEPING/ACCOUNTANT không có tuyến booking nào (api.md §6.3) và mọi tuyến đòi Bearer (401).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { bookingSummarySchema } from '@pinehill/contracts';
import {
  GUEST_PHONE,
  OTHER_GUEST_PHONE,
  booking,
  bookingBody,
  bookingRequest,
  confirmRequest,
  createBooking,
  getRequest,
  guestId,
  guestTokenFor,
  http,
  issueQuote,
  listRequest,
  otherGuestId,
  otherGuestToken,
  otherPropertyId,
  otherTypeId,
  staffToken,
  userId,
} from './fixture.js';
import { codeOf } from './shared.js';

const pageOf = (body: unknown) =>
  z
    .object({
      data: z.array(bookingSummarySchema),
      meta: z.object({
        limit: z.number(),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
        total: z.number(),
      }),
    })
    .parse(body);

test('AC4: khách chỉ thấy booking của mình; lọc, tìm và phân trang theo hợp đồng', async () => {
  const first = await createBooking();
  const second = await createBooking({}, { checkIn: '2026-11-10', checkOut: '2026-11-12' });
  await createBooking({}, { checkIn: '2026-11-20', checkOut: '2026-11-21' });
  // Booking của khách khác trong cùng kỳ: KHÔNG được xuất hiện trong danh sách của khách này.
  const stranger = await createBooking(
    { guest: { fullName: 'Khách khác', phone: OTHER_GUEST_PHONE } },
    { token: otherGuestToken },
  );

  const page = pageOf((await listRequest()).body);
  expect(page.meta).toMatchObject({ limit: 20, hasMore: false, total: 3 });
  expect(page.data.map((item) => item.id)).not.toContain(stranger.booking.id);
  expect(page.data.every((item) => item.guestId === guestId)).toBe(true);
  expect(pageOf((await listRequest({}, { token: otherGuestToken })).body).data).toHaveLength(1);

  const byStatus = await listRequest({ status: 'HELD' });
  expect(pageOf(byStatus.body).meta.total).toBe(3);
  const byWindow = await listRequest({ from: '2026-11-05', to: '2026-11-15' });
  expect(pageOf(byWindow.body).data.map((item) => item.id)).toEqual([second.booking.id]);
  const byCode = await listRequest({ q: second.booking.code });
  expect(pageOf(byCode.body).data.map((item) => item.id)).toEqual([second.booking.id]);
  const byPhone = await listRequest({ q: GUEST_PHONE });
  expect(pageOf(byPhone.body).meta.total).toBe(3);

  const firstPage = pageOf((await listRequest({ limit: 2 })).body);
  expect(firstPage.data).toHaveLength(2);
  expect(firstPage.meta.hasMore).toBe(true);
  const secondPage = pageOf(
    (await listRequest({ limit: 2, cursor: firstPage.meta.nextCursor! })).body,
  );
  expect(secondPage.data).toHaveLength(1);
  expect(secondPage.meta.hasMore).toBe(false);
  expect(new Set([...firstPage.data, ...secondPage.data].map((item) => item.id)).size).toBe(3);

  const badDate = await listRequest({ from: '2026-11-31' });
  expect(badDate.status).toBe(400);
  expect(codeOf(badDate.body)).toBe('E_GEN_VALIDATION_FAILED');
  expect(first.booking.id).toBeTruthy();
});

test('AC4: GET /bookings/{id} theo quyền — khách lạ 404, nhân viên theo phạm vi cơ sở', async () => {
  const mine = await createBooking();
  const foreign = await createBooking(
    { guest: { fullName: 'Khách khác', phone: OTHER_GUEST_PHONE } },
    { token: otherGuestToken },
  );
  const elsewhere = await booking({ property: otherPropertyId, type: otherTypeId });

  expect((await getRequest(mine.booking.id)).status).toBe(200);
  const stranger = await getRequest(mine.booking.id, { token: otherGuestToken });
  expect(stranger.status).toBe(404);
  expect(codeOf(stranger.body)).toBe('E_GEN_NOT_FOUND');
  expect((await getRequest(foreign.booking.id, { token: otherGuestToken })).status).toBe(200);

  const frontDesk = await staffToken('FRONT_DESK');
  expect((await getRequest(mine.booking.id, { token: frontDesk })).status).toBe(200);
  const outOfScope = await getRequest(elsewhere.id, { token: frontDesk });
  expect(outOfScope.status).toBe(403);
  expect(codeOf(outOfScope.body)).toBe('E_AUTH_OUT_OF_SCOPE');

  const scoped = pageOf((await listRequest({}, { token: frontDesk })).body).data;
  expect(scoped.map((item) => item.id)).toContain(mine.booking.id);
  expect(scoped.map((item) => item.id)).not.toContain(elsewhere.id);

  const owner = await staffToken('OWNER');
  expect((await getRequest(elsewhere.id, { token: owner })).status).toBe(200);
  expect(
    pageOf((await listRequest({}, { token: owner })).body).data.map((item) => item.id),
  ).toContain(elsewhere.id);

  // Nhân viên tạo booking tại quầy: hồ sơ khách tạo theo SĐT (BR-CRM-01) và `createdBy` là nhân viên.
  const counterQuote = await issueQuote(
    { checkIn: '2026-11-25', checkOut: '2026-11-26' },
    frontDesk,
  );
  const counter = await bookingRequest(
    {
      ...bookingBody({
        checkIn: '2026-11-25',
        checkOut: '2026-11-26',
        guest: { fullName: 'Khách Tại Quầy', phone: '0912345678' },
      }),
      quoteId: counterQuote.quoteId,
    },
    { token: frontDesk },
  );
  expect(counter.status).toBe(201);
  const counterBooking = bookingSummarySchema.parse(counter.body);
  expect(counterBooking.createdBy).toBe(userId);
  expect(counterBooking.guestId).not.toBe(guestId);
});

test('AC4: HOUSEKEEPING và ACCOUNTANT không có tuyến booking; thiếu bearer ⇒ 401', async () => {
  const mine = await createBooking();
  const housekeeping = await staffToken('HOUSEKEEPING');
  const accountant = await staffToken('ACCOUNTANT');

  for (const token of [housekeeping, accountant]) {
    const list = await listRequest({}, { token });
    expect(list.status).toBe(403);
    expect(codeOf(list.body)).toBe('E_RBAC_FORBIDDEN');
    const one = await getRequest(mine.booking.id, { token });
    expect(one.status).toBe(403);
    expect(codeOf(one.body)).toBe('E_RBAC_FORBIDDEN');
  }
  const create = await bookingRequest(
    { ...bookingBody(), quoteId: (await issueQuote()).quoteId },
    { token: housekeeping },
  );
  expect(create.status).toBe(403);
  expect(codeOf(create.body)).toBe('E_RBAC_FORBIDDEN');
  const confirm = await confirmRequest(mine.booking.id, randomUUID(), { token: housekeeping });
  expect(confirm.status).toBe(403);
  expect(codeOf(confirm.body)).toBe('E_RBAC_FORBIDDEN');

  const anonymous = [
    await listRequest({}, { token: null }),
    await getRequest(mine.booking.id, { token: null }),
    await bookingRequest(bookingBody(), { token: null }),
    await confirmRequest(mine.booking.id, randomUUID(), { token: null }),
  ];
  for (const response of anonymous) {
    expect(response.status).toBe(401);
    expect(codeOf(response.body)).toBe('E_AUTH_INVALID_CREDENTIALS');
  }

  // Token của khách khác vẫn đọc được booking của chính họ (không 401 oan).
  expect(
    (await getRequest(mine.booking.id, { token: await guestTokenFor(otherGuestId) })).status,
  ).toBe(404);
  expect(OTHER_GUEST_PHONE).not.toBe(GUEST_PHONE);
  expect(
    (await http().get('/api/v1/bookings').set('Authorization', 'Bearer not-a-token')).status,
  ).toBe(401);
});
