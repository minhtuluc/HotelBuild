import { expect, test } from 'vitest';
import { guestLoyaltySchema, guestSummarySchema } from '@pinehill/contracts';
import { setup } from './f5-fixtures.js';
const f = setup();
test('booking list requires a valid actor and only exposes the guest own bookings', async () => {
  const owner = await f.actor('synthetic-owner');
  const other = await f.actor('synthetic-other');
  const own = await f.booking(owner);
  await f.booking(other);
  expect((await f.raw('/bookings')).status).toBe(401);
  expect((await f.raw('/bookings', undefined, 'synthetic-invalid')).status).toBe(401);
  const page = (await owner.bookings.list()).data;
  expect(page.data.map((value) => value.id)).toEqual([own.id]);
  expect(page.meta).toEqual({ limit: 20, total: 1, hasMore: false, nextCursor: null });
});
test('staff list enforces property scope and role even when filters request another property', async () => {
  const owner = await f.actor();
  const a = await f.booking(owner);
  await f.booking(owner, 'synthetic-other-property');
  const clerk = await f.actor('synthetic-clerk', 'FRONT_DESK');
  expect((await clerk.bookings.list()).data.data.map((row) => row.id)).toEqual([a.id]);
  expect((await clerk.bookings.list({ propertyId: 'synthetic-other-property' })).data.data).toEqual(
    [],
  );
  const denied = await f.actor('synthetic-housekeeper', 'HOUSEKEEPING');
  await expect(denied.bookings.list()).rejects.toMatchObject({ status: 403 });
});
test('cursor pagination cannot reference a booking outside the actor filtered result', async () => {
  const owner = await f.actor();
  const a = await f.booking(owner);
  const b = await f.booking(owner);
  const other = await f.actor('synthetic-other');
  const hidden = await f.booking(other);
  const first = (await owner.bookings.list({ limit: 1 })).data;
  expect(first.data.map((row) => row.id)).toEqual([a.id]);
  expect(first.meta).toEqual({ limit: 1, total: 2, hasMore: true, nextCursor: a.id });
  const second = (await owner.bookings.list({ limit: 1, cursor: a.id })).data;
  expect(second.data.map((row) => row.id)).toEqual([b.id]);
  expect(second.meta.hasMore).toBe(false);
  await expect(owner.bookings.list({ cursor: hidden.id })).rejects.toMatchObject({ status: 400 });
  expect((await f.raw('/bookings?limit=0', undefined, owner.accessToken)).status).toBe(400);
  expect((await f.raw('/bookings?guestId=other', undefined, owner.accessToken)).status).toBe(400);
});
test('list filters and deletion read the same live state as F5 commands', async () => {
  const owner = await f.actor();
  const a = await f.booking(owner);
  const b = await f.booking(owner);
  await f.control(owner, a.id, 'cancel');
  expect(
    (await owner.bookings.list({ status: 'CANCELLED' })).data.data.map((row) => row.id),
  ).toEqual([a.id]);
  expect((await owner.bookings.list({ channelCode: 'PHONE' })).data.data).toEqual([]);
  const clerk = await f.actor('synthetic-clerk', 'FRONT_DESK');
  await clerk.bookings.deleteBooking(b.id, 'synthetic abandoned');
  expect((await owner.bookings.list()).data.data.map((row) => row.id)).toEqual([a.id]);
});
test('self profile and loyalty use the guest session and return matching synthetic identities', async () => {
  const a = await f.actor('synthetic-profile-a');
  const b = await f.actor('synthetic-profile-b');
  const booking = await f.booking(a);
  const response = await f.raw('/guests/me', undefined, a.accessToken);
  expect(response.status).toBe(200);
  const profile = guestSummarySchema.parse(await response.json());
  expect(profile.id).toBe(booking.guestId);
  const loyaltyResponse = await f.raw('/guests/me/loyalty', undefined, a.accessToken);
  expect(loyaltyResponse.status).toBe(200);
  expect(guestLoyaltySchema.parse(await loyaltyResponse.json()).guestId).toBe(profile.id);
  const second = await f.raw('/guests/me', undefined, b.accessToken);
  expect(guestSummarySchema.parse(await second.json()).id).not.toBe(profile.id);
  expect(JSON.stringify(profile)).not.toContain(a.accessToken);
  expect(JSON.stringify(profile)).not.toContain(a.name);
});
test('self profile endpoints reject unauthenticated and staff sessions', async () => {
  const staff = await f.actor('synthetic-staff', 'FRONT_DESK');
  for (const path of ['/guests/me', '/guests/me/loyalty']) {
    expect((await f.raw(path)).status).toBe(401);
    expect((await f.raw(path, undefined, staff.accessToken)).status).toBe(403);
  }
});

test('matching channel filters preserve the original channel code rather than the opaque channelId', async () => {
  const owner = await f.actor();
  const web = await f.booking(owner);
  const phone = await f.booking(owner, 'journey-standard', 'FLEX7', 'PHONE');
  expect(
    (await owner.bookings.list({ channelCode: 'WEB' })).data.data.map((row) => row.id),
  ).toEqual([web.id]);
  expect(
    (await owner.bookings.list({ channelCode: 'PHONE' })).data.data.map((row) => row.id),
  ).toEqual([phone.id]);
});
