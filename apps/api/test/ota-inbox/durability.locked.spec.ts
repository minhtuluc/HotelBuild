/**
 * HB-128 A — khoá tính bền của inbox và cửa sổ dedup của webhook OTA (ADR-017 quyết định 3–5).
 *
 * Bốn ca, mỗi ca ứng với một dòng tiêu chí nghiệm thu của ticket:
 * - `durable-before-202` (AC4): `booking.created/modified/cancelled` commit `webhook_inbox` (provider,
 *   account, eventId, hash, payload nghiệp vụ đã chuẩn hoá, `signature_verified_at`) **trước** `202`;
 *   payload sai cấu trúc ⇒ `400 E_GEN_VALIDATION_FAILED`; chưa áp booking (HB-129) ở tầng này.
 * - `db-failure-and-queue-loss` (AC5): CSDL lỗi trước commit ⇒ không ACK thành công (`503`); commit xong
 *   rồi mất Redis (queue) vẫn còn hàng inbox `PENDING` cho HB-129 quét phục hồi.
 * - `seven-day-concurrent-replay` (AC6): mỗi HTTP verify lại trước dedup; trong 7 ngày cùng
 *   `(provider, account, eventId)` + hash ⇒ `200 {duplicate:true}` kể cả inbox đang chờ; 5 lần gửi đồng
 *   thời chỉ một hàng inbox và không đổi payload gốc.
 * - `hash-conflict-and-account-isolation` (AC7): cùng event ID khác hash ⇒ `409 E_CHAN_REPLAY_DETECTED`
 *   giữ bản gốc; cùng event ID ở account khác không bị gộp; dọn inbox 7 ngày không xoá uniqueness
 *   nghiệp vụ `(channelId, externalRef)` của HB-129.
 *
 * File này là oracle của phase A: nó đỏ vì route thiếu, không vì fixture. Không sửa assertion khi làm B.
 */
import { expect, test } from 'vitest';
import {
  accountOf,
  ack,
  channelId,
  clock,
  deliver,
  draft,
  errorCode,
  eventId,
  flushCache,
  inboxAll,
  inboxOf,
  isObject,
  pendingScan,
  propertyId,
  rows,
  storedPayload,
} from './fixture.js';
import { TableOutage } from './fault.js';

test('durable-before-202', async () => {
  for (const eventType of ['booking.created', 'booking.modified', 'booking.cancelled'] as const) {
    const id = eventId(`durable-${eventType.split('.')[1]}`);
    const { raw } = draft({ eventType });
    const response = await deliver({ provider: 'booking', eventId: id, raw });
    expect(response.status, eventType).toBe(202);
    expect(ack(response.body), eventType).toEqual({ duplicate: false, eventId: id });

    const stored = await inboxOf(id);
    expect(stored, eventType).toHaveLength(1);
    const row = stored[0]!;
    expect(row.provider).toBe('booking');
    expect(row.provider_account_id).toBe(accountOf('booking').accountId);
    expect(row.status).toBe('PENDING');
    expect(String(row.payload_hash).length).toBeGreaterThan(0);
    // Dấu xác minh dùng đúng clock được tiêm (không phải giờ hệ điều hành).
    const verifiedAt = row.signature_verified_at;
    expect(
      verifiedAt instanceof Date ? verifiedAt.getTime() : new Date(String(verifiedAt)).getTime(),
    ).toBe(clock.now().getTime());
    const payload = storedPayload(row);
    expect(payload.channelCode).toBe('OTA_BOOKING');
    expect(payload.eventType).toBe(eventType);
    expect(payload.providerBookingCode).toBe('HB128-BK-0001');
    // ACK chỉ sau khi bền hoá sự kiện; áp booking là việc của HB-129, không chạy trong request này.
    const bookings = await rows('SELECT id FROM bookings WHERE external_ref=$1', ['HB128-BK-0001']);
    expect(bookings).toHaveLength(0);
  }

  // Payload sai cấu trúc: strict schema của HB-120, mọi trường hợp trả 400 và không ghi inbox.
  const base = draft({ provider: 'booking' });
  const mutate = (change: (body: Record<string, unknown>) => void): string => {
    const parsed: unknown = JSON.parse(base.raw);
    if (!isObject(parsed)) throw new Error('Fixture payload must be a JSON object');
    change(parsed);
    return JSON.stringify(parsed);
  };
  const invalid = [
    mutate((body) => delete body.amount),
    mutate((body) => {
      body.approvedBy = 'hb128-forged';
    }),
    mutate((body) => {
      body.eventType = 'booking.merged';
    }),
    mutate((body) => {
      body.currency = 'USD';
    }),
    mutate((body) => {
      body.roomCount = 0;
    }),
    mutate((body) => {
      body.guest = { fullName: 'HB128 Synthetic Guest', phone: '0900' };
    }),
  ];
  for (const [index, raw] of invalid.entries()) {
    const response = await deliver({
      provider: 'booking',
      eventId: eventId(`durable-invalid-${index}`),
      raw,
    });
    expect(response.status, `payload sai #${index}`).toBe(400);
    expect(errorCode(response.body), `payload sai #${index}`).toBe('E_GEN_VALIDATION_FAILED');
  }

  // Header thiếu event ID là lỗi cấu trúc yêu cầu, không phải lỗi chữ ký.
  const missingEventId = await deliver({
    provider: 'booking',
    eventId: eventId('durable-missing-event-id'),
    raw: base.raw,
    omitEventId: true,
  });
  expect(missingEventId.status).toBe(400);
  expect(errorCode(missingEventId.body)).toBe('E_GEN_VALIDATION_FAILED');

  expect(await inboxAll()).toHaveLength(3);
});

test('db-failure-and-queue-loss', async () => {
  const failed = draft({ bookingCode: 'HB128-DB-0001' });
  const outage = await TableOutage.start('webhook_inbox', 'hb128out');
  try {
    const response = await deliver({
      provider: 'booking',
      eventId: eventId('db-outage'),
      raw: failed.raw,
    });
    // Không ACK thành công khi chưa commit được (api.md §5.3 + HB-120 `otaInboxAckSchema`).
    expect(response.status).toBe(503);
    expect(errorCode(response.body)).toBe('E_GEN_SERVICE_UNAVAILABLE');
  } finally {
    await outage.restore();
  }
  expect(await inboxAll()).toHaveLength(0);

  // Mất Redis sau ACK không được làm mất cam kết: inbox là nguồn bền duy nhất.
  const durableId = eventId('db-queue-loss');
  const durable = draft({ bookingCode: 'HB128-DB-0002' });
  const accepted = await deliver({ provider: 'booking', eventId: durableId, raw: durable.raw });
  expect(accepted.status).toBe(202);
  await flushCache();
  const pending = await pendingScan();
  expect(pending.map((row) => String(row.event_id))).toEqual([durableId]);
  expect(pending[0]!.status).toBe('PENDING');

  // Phát lại sau khi mất cache: vẫn là bản trùng hợp lệ, không thêm hàng.
  const replay = await deliver({ provider: 'booking', eventId: durableId, raw: durable.raw });
  expect(replay.status).toBe(200);
  expect(ack(replay.body)).toEqual({ duplicate: true, eventId: durableId });
  expect(await inboxAll()).toHaveLength(1);
});

test('seven-day-concurrent-replay', async () => {
  const id = eventId('seven-day');
  const { raw } = draft({ bookingCode: 'HB128-7D-0001' });

  // Năm request đồng thời cùng raw/event ID: UNIQUE của inbox chỉ cho một hàng, còn lại là bản trùng.
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => deliver({ provider: 'booking', eventId: id, raw })),
  );
  const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
  expect(statuses).toEqual([200, 200, 200, 200, 202]);
  for (const response of responses) {
    expect(ack(response.body)).toEqual({ duplicate: response.status === 200, eventId: id });
  }

  const stored = await inboxOf(id);
  expect(stored).toHaveLength(1);
  const original = stored[0]!;
  expect(original.status).toBe('PENDING');

  // Trong cửa sổ 7 ngày (đang chờ xử lý) phát lại vẫn 200 và KHÔNG đổi payload gốc.
  clock.value += 6 * 24 * 60 * 60 * 1000;
  const late = await deliver({ provider: 'booking', eventId: id, raw });
  expect(late.status).toBe(200);
  expect(ack(late.body)).toEqual({ duplicate: true, eventId: id });
  const unchanged = await inboxOf(id);
  expect(unchanged).toHaveLength(1);
  expect(unchanged[0]!.payload_hash).toBe(original.payload_hash);
  expect(unchanged[0]!.payload_json).toEqual(original.payload_json);
});

test('hash-conflict-and-account-isolation', async () => {
  const id = eventId('conflict');
  const originalDraft = draft({ bookingCode: 'HB128-CONFLICT-0001', amount: 2_400_000 });
  const accepted = await deliver({ provider: 'booking', eventId: id, raw: originalDraft.raw });
  expect(accepted.status).toBe(202);
  const stored = await inboxOf(id);
  expect(stored).toHaveLength(1);
  const original = stored[0]!;

  // Cùng event ID, nội dung khác, chữ ký hợp lệ ⇒ 409 và giữ nguyên bản gốc (không ghi đè payload).
  const conflicting = draft({ bookingCode: 'HB128-CONFLICT-0001', amount: 3_100_000 });
  const conflict = await deliver({ provider: 'booking', eventId: id, raw: conflicting.raw });
  expect(conflict.status).toBe(409);
  expect(errorCode(conflict.body)).toBe('E_CHAN_REPLAY_DETECTED');
  const afterConflict = await inboxOf(id);
  expect(afterConflict).toHaveLength(1);
  expect(afterConflict[0]!.payload_hash).toBe(original.payload_hash);
  expect(afterConflict[0]!.payload_json).toEqual(original.payload_json);

  // Cùng event ID ở account khác của cùng provider: khoá tự nhiên khác, không bị gộp.
  const secondAccount = accountOf('booking', 1);
  const isolatedDraft = draft({ provider: 'booking', account: secondAccount, amount: 3_100_000 });
  const isolated = await deliver({
    provider: 'booking',
    account: secondAccount,
    eventId: id,
    raw: isolatedDraft.raw,
  });
  expect(isolated.status).toBe(202);
  expect(ack(isolated.body)).toEqual({ duplicate: false, eventId: id });
  const both = await inboxOf(id);
  expect(both.map((row) => String(row.provider_account_id)).sort()).toEqual(
    [accountOf('booking').accountId, secondAccount.accountId].sort(),
  );

  // Dọn inbox theo retention 7 ngày KHÔNG xoá uniqueness nghiệp vụ của HB-129.
  const externalRef = 'HB128-CONFLICT-0001';
  const channel = await channelId('OTA_BOOKING');
  const insertExternalBooking = (code: string) =>
    rows(
      `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status,external_ref)
       VALUES($1,(SELECT id FROM guests ORDER BY created_at LIMIT 1),$2,
              (SELECT id FROM room_types WHERE property_id=$2 AND code='STD'),
              (SELECT id FROM rate_plans WHERE code='FLEX7'),$3,
              DATE '2026-12-10',DATE '2026-12-12',2,30,'CONFIRMED',$4)`,
      [code, propertyId, channel, externalRef],
    );
  await insertExternalBooking('PH-261210-OTA01');

  // Retention của chính sách 7 ngày: hàng inbox của sự kiện bị dọn, cam kết nghiệp vụ thì ở lại.
  await rows('DELETE FROM webhook_inbox WHERE event_id=$1', [id]);
  expect(await inboxOf(id)).toHaveLength(0);

  await expect(insertExternalBooking('PH-261210-OTA02')).rejects.toMatchObject({ code: '23505' });
  const kept = await rows('SELECT external_ref FROM bookings WHERE external_ref=$1', [externalRef]);
  expect(kept).toHaveLength(1);
});
