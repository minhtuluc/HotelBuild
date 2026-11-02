/**
 * HB-129 AC12 — cờ nghi trùng có scope, If-Match và Idempotency, không tác động tiền (giai đoạn A).
 *
 * `POST /channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag` phải chạy trong **một**
 * transaction: cờ + actor + lý do + version + audit cùng commit; gắn/gỡ cờ không huỷ/gộp booking và
 * không sửa tiền/snapshot/used. Phát lại cùng `Idempotency-Key` không ghi quyết định thứ hai.
 *
 * File đỏ vì route chưa tồn tại (404) — B hiện thực theo HB-120 §2.7 + migration 0009.
 */
import { randomUUID } from 'node:crypto';
import { errorBodySchema } from '@pinehill/contracts';
import { expect, test } from 'vitest';
import { DUPLICATE_FLAG_ACTION } from './contract.js';
import {
  applyNew,
  auditOf,
  bookingById,
  channelIdOf,
  chargesOf,
  count,
  http,
  one,
  otaTotal,
  paymentsOf,
  rows,
  secondUserId,
  snapshotsOf,
  staffToken,
  stay,
  TableOutage,
  text,
  typeId,
  userId,
} from './fixture.js';

const errorCode = (body: unknown): string => errorBodySchema.parse(body).code;

interface FlagOptions {
  readonly token: string;
  readonly key?: string | null;
  readonly ifMatch?: string;
}

function flagFor(channelId: string, bookingId: string, body: object, options: FlagOptions) {
  const call = http().post(
    `/api/v1/channels/${channelId}/ota-bookings/${bookingId}/duplicate-flag`,
  );
  call.set('Authorization', `Bearer ${options.token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  if (options.ifMatch !== undefined) call.set('If-Match', options.ifMatch);
  return call.send(body);
}

test('scoped_duplicate_review_without_financial_effects', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const total = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  const { bookingId } = await applyNew('review-create', {
    bookingCode: 'HB129-REVIEW-1',
    amount: total,
  });
  const manager = await staffToken('MANAGER');
  const initial = one(await bookingById(bookingId));
  const version = count(initial.version);
  const paymentsBefore = await paymentsOf(bookingId);
  const snapshotsBefore = await snapshotsOf(bookingId);
  const chargesBefore = await chargesOf(bookingId);
  const reason = 'Khách báo trùng mã OTA';

  const key = randomUUID();
  const flagged = await flagFor(
    channel,
    bookingId,
    { flagged: true, reason },
    {
      token: manager,
      key,
      ifMatch: `"${version}"`,
    },
  );
  expect(flagged.status, JSON.stringify(flagged.body)).toBe(200);
  expect(flagged.headers.etag).toBe(`"${version + 1}"`);

  const after = one(await bookingById(bookingId));
  expect(after.duplicate_suspected).toBe(true);
  expect(text(after.duplicate_suspected_by)).toBe(userId);
  expect(text(after.duplicate_suspected_reason)).toBe(reason);
  expect(after.duplicate_suspected_at).not.toBeNull();
  expect(count(after.duplicate_suspected_version)).toBe(1);
  expect(count(after.version)).toBe(version + 1);
  expect(text(after.status)).toBe('CONFIRMED');
  expect(after.cancelled_at).toBeNull();
  expect(count(after.total_amount)).toBe(total);
  expect(await paymentsOf(bookingId)).toEqual(paymentsBefore);
  expect(await snapshotsOf(bookingId)).toEqual(snapshotsBefore);
  expect(await chargesOf(bookingId)).toEqual(chargesBefore);
  expect(count(one(await rows('SELECT count(*) AS n FROM room_merges')).n)).toBe(0);

  const decisions = (await auditOf(bookingId)).filter(
    (row) => text(row.action) === DUPLICATE_FLAG_ACTION,
  );
  expect(decisions).toHaveLength(1);
  expect(text(decisions[0]?.actor_id)).toBe(userId);
  expect(text(decisions[0]?.actor_role)).toBe('MANAGER');

  const replay = await flagFor(
    channel,
    bookingId,
    { flagged: true, reason },
    {
      token: manager,
      key,
      ifMatch: `"${version}"`,
    },
  );
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(flagged.body);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(count(one(await bookingById(bookingId)).duplicate_suspected_version)).toBe(1);
  expect(
    (await auditOf(bookingId)).filter((row) => text(row.action) === DUPLICATE_FLAG_ACTION),
  ).toHaveLength(1);

  const cleared = await flagFor(
    channel,
    bookingId,
    { flagged: false, reason: 'Đã xác minh không trùng' },
    {
      token: manager,
      key: randomUUID(),
      ifMatch: `"${version + 1}"`,
    },
  );
  expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
  const finalRow = one(await bookingById(bookingId));
  expect(finalRow.duplicate_suspected).toBe(false);
  expect(finalRow.duplicate_suspected_by).toBeNull();
  expect(finalRow.duplicate_suspected_reason).toBeNull();
  expect(finalRow.duplicate_suspected_at).toBeNull();
  expect(count(finalRow.duplicate_suspected_version)).toBe(2);
  expect(count(finalRow.version)).toBe(version + 2);
  expect(text(finalRow.status)).toBe('CONFIRMED');
  expect(await paymentsOf(bookingId)).toEqual(paymentsBefore);

  const missingIfMatch = await flagFor(
    channel,
    bookingId,
    { flagged: true, reason },
    {
      token: manager,
      key: randomUUID(),
    },
  );
  expect(missingIfMatch.status).toBe(428);
  expect(errorCode(missingIfMatch.body)).toBe('E_GEN_PRECONDITION_REQUIRED');
  const stale = await flagFor(
    channel,
    bookingId,
    { flagged: true, reason },
    {
      token: manager,
      key: randomUUID(),
      ifMatch: '"1"',
    },
  );
  expect(stale.status).toBe(412);
  expect(errorCode(stale.body)).toBe('E_GEN_VERSION_CONFLICT');
  const blank = await flagFor(
    channel,
    bookingId,
    { flagged: true, reason: '' },
    {
      token: manager,
      key: randomUUID(),
      ifMatch: `"${version + 2}"`,
    },
  );
  expect(blank.status).toBe(400);
  expect(errorCode(blank.body)).toBe('E_GEN_VALIDATION_FAILED');
  const noKey = await flagFor(
    channel,
    bookingId,
    { flagged: true, reason },
    {
      token: manager,
      key: null,
      ifMatch: `"${version + 2}"`,
    },
  );
  expect(noKey.status).toBe(400);
  expect(errorCode(noKey.body)).toBe('E_GEN_VALIDATION_FAILED');

  const frontDesk = await staffToken('FRONT_DESK', 'h029-second');
  const forbidden = await flagFor(
    channel,
    bookingId,
    { flagged: true, reason },
    {
      token: frontDesk,
      key: randomUUID(),
      ifMatch: `"${version + 2}"`,
    },
  );
  expect(forbidden.status).toBe(403);
  expect(errorCode(forbidden.body)).toBe('E_RBAC_FORBIDDEN');
  const outsider = await staffToken('MANAGER', 'h029-second');
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [secondUserId]);
  const outOfScope = await flagFor(
    channel,
    bookingId,
    { flagged: true, reason },
    {
      token: outsider,
      key: randomUUID(),
      ifMatch: `"${version + 2}"`,
    },
  );
  expect(outOfScope.status).toBe(403);
  expect(errorCode(outOfScope.body)).toBe('E_AUTH_OUT_OF_SCOPE');
  const otherChannel = await channelIdOf('OTA_AGODA');
  const wrongChannel = await flagFor(
    otherChannel,
    bookingId,
    { flagged: true, reason },
    {
      token: manager,
      key: randomUUID(),
      ifMatch: `"${version + 2}"`,
    },
  );
  expect(wrongChannel.status).toBe(404);
  expect(errorCode(wrongChannel.body)).toBe('E_GEN_NOT_FOUND');

  const outage = await TableOutage.start('audit_logs', 'hb129flag');
  try {
    const failed = await flagFor(
      channel,
      bookingId,
      { flagged: true, reason },
      {
        token: manager,
        key: randomUUID(),
        ifMatch: `"${version + 2}"`,
      },
    );
    expect(failed.status).toBeGreaterThanOrEqual(500);
  } finally {
    await outage.restore();
  }
  expect(one(await bookingById(bookingId)).duplicate_suspected).toBe(false);
  expect(await paymentsOf(bookingId)).toEqual(paymentsBefore);
});
