import { expect, test } from 'vitest';
import { setup, online } from './f5-fixtures.js';
const f = setup();
test('hard delete is a FRONT_DESK command, never a guest or reservation-agent command', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const reservation = await f.actor('synthetic-reservation', 'RESERVATION_AGENT');
  for (const actor of [owner, reservation])
    await expect(
      actor.bookings.deleteBooking(booking.id, 'Synthetic abandoned'),
    ).rejects.toMatchObject({ status: 403, code: 'E_RBAC_FORBIDDEN' });
  expect((await owner.bookings.get(booking.id)).data.id).toBe(booking.id);
});
test.each([
  ['FLEX7', 96, 50, 150000],
  ['SAVER3', 96, 100, 300000],
  ['LONGSTAY14', 200, 50, 150000],
  ['NONREF', 96, 0, 0],
] as const)(
  'published %s sample tier cannot contradict its nominal hours',
  async (plan, hours, percent, requested) => {
    const owner = await f.actor();
    const booking = await f.booking(owner, 'journey-standard', plan);
    const payment = (await owner.payments.createOnline(online(booking.id))).data;
    await f.control(owner, booking.id, 'payment-success', payment.paymentId);
    expect(
      (
        await owner.bookings.cancelPreview(booking.id, {
          reason: 'GUEST_REQUEST',
          isForceMajeure: false,
        })
      ).data.cancellation,
    ).toMatchObject({
      hoursBeforeCheckIn: hours,
      refundPercent: percent,
      requestedAmount: requested,
    });
  },
);
test('successful delete is replayable after removal but cannot cross principals', async () => {
  const owner = await f.actor();
  const clerk = await f.actor('synthetic-clerk', 'FRONT_DESK');
  const other = await f.actor('synthetic-other-clerk', 'FRONT_DESK');
  const booking = await f.booking(owner);
  const path = `/bookings/${booking.id}?reason=synthetic`;
  const key = crypto.randomUUID();
  expect((await f.raw(path, undefined, clerk.accessToken, 'DELETE', key)).status).toBe(204);
  const retry = await f.raw(path, undefined, clerk.accessToken, 'DELETE', key);
  expect(retry.status).toBe(204);
  expect(retry.headers.get('idempotency-replayed')).toBe('true');
  expect((await f.raw(path, undefined, other.accessToken, 'DELETE', key)).status).toBe(404);
  expect((await f.raw(path, undefined, clerk.accessToken, 'DELETE')).status).toBe(404);
});
test('preview is read-only and unconfirmed cancellation refunds all 250499 VND without rounding', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  await f.control(owner, booking.id, 'unconfirmed-partial');
  const input = { reason: 'GUEST_REQUEST' as const, isForceMajeure: false };
  const preview = (await owner.bookings.cancelPreview(booking.id, input)).data;
  expect(preview.cancellation).toMatchObject({
    paidAmount: 250499,
    requestedAmount: 250499,
    refundPercent: 100,
    refundFee: 0,
  });
  expect((await owner.bookings.get(booking.id)).data.status).toBe('HELD');
  expect((await owner.refunds.list({ bookingId: booking.id })).data.data).toEqual([]);
  const cancelled = (await owner.bookings.cancel(booking.id, input)).data;
  expect(cancelled.status).toBe('CANCELLED');
  expect(cancelled.cancellation).toEqual(preview.cancellation);
  expect((await owner.refunds.list({ bookingId: booking.id })).data.data[0]).toMatchObject({
    requestedAmount: 250499,
    status: 'PENDING',
  });
  await expect(owner.bookings.cancel(booking.id, input)).rejects.toMatchObject({
    status: 409,
    code: 'E_CANCEL_NOT_ALLOWED',
  });
});
test('reschedule retains state, changes dates/count and does not create a refund', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const changed = (
    await owner.bookings.reschedule(booking.id, {
      checkIn: '2026-10-20',
      checkOut: '2026-10-22',
      reason: 'Synthetic dates',
    })
  ).data;
  expect(changed).toMatchObject({
    status: 'HELD',
    checkIn: '2026-10-20',
    checkOut: '2026-10-22',
    nights: 2,
    rescheduleCount: 1,
    totalAmount: 2000000,
  });
  expect((await owner.refunds.list({ bookingId: booking.id })).data.data).toEqual([]);
  await expect(
    owner.bookings.reschedule(booking.id, { checkIn: '2026-10-22', checkOut: '2026-10-20' }),
  ).rejects.toMatchObject({ status: 422, code: 'E_BOOK_INVALID_DATES' });
  const conflict = await f.booking(owner);
  await f.control(owner, conflict.id, 'reschedule-conflict');
  await expect(
    owner.bookings.reschedule(conflict.id, { checkIn: '2026-10-23', checkOut: '2026-10-24' }),
  ).rejects.toMatchObject({ status: 409, code: 'E_INV_ROOM_TAKEN' });
});
test('hard delete requires reason and DRAFT/HELD without any payment', async () => {
  const owner = await f.actor();
  const clerk = await f.actor('synthetic-clerk', 'FRONT_DESK');
  const empty = await f.booking(owner);
  expect(
    (await f.raw(`/bookings/${empty.id}`, undefined, clerk.accessToken, 'DELETE')).status,
  ).toBe(400);
  expect((await clerk.bookings.deleteBooking(empty.id, 'Synthetic abandoned')).status).toBe(204);
  await expect(owner.bookings.get(empty.id)).rejects.toMatchObject({ status: 404 });
  const paid = await f.booking(owner);
  await owner.payments.createOnline(online(paid.id));
  await expect(clerk.bookings.deleteBooking(paid.id, 'Synthetic abandoned')).rejects.toMatchObject({
    status: 409,
    code: 'E_BOOK_HARD_DELETE_FORBIDDEN',
  });
});
test('guest cannot request force majeure, hotel reason, partial rooms or inject money', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  for (const body of [
    { reason: 'FORCE_MAJEURE' as const, isForceMajeure: true },
    { reason: 'HOTEL_RELOCATION' as const, isForceMajeure: false },
  ])
    await expect(owner.bookings.cancel(booking.id, body)).rejects.toMatchObject({ status: 403 });
  expect(
    (
      await f.raw(
        `/bookings/${booking.id}/cancel`,
        { reason: 'GUEST_REQUEST', isForceMajeure: false, requestedAmount: 999999 },
        owner.accessToken,
      )
    ).status,
  ).toBe(400);
  // No BookingRoom IDs are supplied by the F4 fixture: do not silently cancel every room.
  expect(
    (
      await f.raw(
        `/bookings/${booking.id}/cancel`,
        { reason: 'GUEST_REQUEST', isForceMajeure: false, bookingRoomIds: ['unknown'] },
        owner.accessToken,
      )
    ).status,
  ).toBe(400);
});
