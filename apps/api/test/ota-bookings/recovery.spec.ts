/**
 * HB-129 AC6 — tính nguyên tử của một lần áp inbox (giai đoạn A, đỏ có chủ đích).
 *
 * Ca duy nhất: mutation booking/ledger/used/snapshot/history/case/audit/outbox **và** việc đóng
 * `webhook_inbox` phải commit cùng nhau. Lỗi ghi ở bất kỳ bước nào ⇒ rollback cả tập; lần chạy lại sau
 * "crash trước commit" áp đúng một lần; chạy lại **sau** commit không lặp tác động.
 *
 * Lỗi được tạo bằng cách đổi tên bảng `audit_logs` đang chạy (mẫu `apps/api/test/ota-inbox/fault.ts`
 * của HB-128), không mock tầng nào — Prisma nhận lỗi "quan hệ không tồn tại" như production.
 */
import { expect, test } from 'vitest';
import {
  applyEvent,
  assignmentsOf,
  channelIdOf,
  clock,
  count,
  inboxOf,
  instantOf,
  otaTotal,
  paymentsOf,
  rows,
  sendEvent,
  snapshotsOf,
  stay,
  TableOutage,
  text,
  typeId,
  one,
} from './fixture.js';

test('atomic-apply-and-crash-replay', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const total = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  const { id } = await sendEvent('atomic-create', {
    bookingCode: 'HB129-ATOMIC-1',
    amount: total,
  });

  const outage = await TableOutage.start('audit_logs', 'hb129atomic');
  try {
    // Transaction được phép ném lỗi ra ngoài (cổng job bắt và quyết định retry) — điều bắt buộc là
    // **không** để lại tác động dở dang nào.
    try {
      await applyEvent(id);
    } catch {
      // dự kiến: INSERT audit_logs thất bại vì bảng đã đổi tên
    }
  } finally {
    await outage.restore();
  }

  expect(await rows('SELECT id FROM bookings WHERE channel_id=$1', [channel])).toHaveLength(0);
  expect(await rows('SELECT id FROM payments')).toHaveLength(0);
  expect(await rows('SELECT id FROM price_snapshots')).toHaveLength(0);
  expect(await rows('SELECT id FROM room_assignments')).toHaveLength(0);
  const pending = one(await inboxOf(id));
  expect(['PENDING', 'PROCESSING', 'FAILED']).toContain(text(pending.status));

  // Crash trước commit: chạy lại làm một lần, đóng PROCESSED bằng đúng đồng hồ tiêm.
  const applied = await applyEvent(id);
  expect(applied.status).toBe('APPLIED');
  const bookings = await rows('SELECT * FROM bookings WHERE channel_id=$1', [channel]);
  expect(bookings).toHaveLength(1);
  const bookingId = text(one(bookings).id);
  const processed = one(await inboxOf(id));
  expect(text(processed.status)).toBe('PROCESSED');
  expect(instantOf(processed.processed_at)).toBe(clock.now().getTime());
  expect(await paymentsOf(bookingId)).toHaveLength(1);
  expect(await snapshotsOf(bookingId)).toHaveLength(1);
  expect(await assignmentsOf(bookingId)).toHaveLength(1);
  const outboxAfterCommit = count(
    one(
      await rows('SELECT count(*) AS n FROM outbox_events WHERE aggregate_id=$1::uuid', [
        bookingId,
      ]),
    ).n,
  );
  const auditAfterCommit = count(
    one(await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1::uuid', [bookingId])).n,
  );
  expect(outboxAfterCommit).toBeGreaterThanOrEqual(1);

  // Sau commit: phát lại cùng event không được lặp bất kỳ tác động nào.
  const replay = await applyEvent(id);
  expect(replay.status).not.toBe('APPLIED');
  expect(await rows('SELECT id FROM bookings WHERE channel_id=$1', [channel])).toHaveLength(1);
  expect(await paymentsOf(bookingId)).toHaveLength(1);
  expect(await snapshotsOf(bookingId)).toHaveLength(1);
  expect(await assignmentsOf(bookingId)).toHaveLength(1);
  expect(
    count(
      one(
        await rows('SELECT count(*) AS n FROM outbox_events WHERE aggregate_id=$1::uuid', [
          bookingId,
        ]),
      ).n,
    ),
  ).toBe(outboxAfterCommit);
  expect(
    count(
      one(await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1::uuid', [bookingId]))
        .n,
    ),
  ).toBe(auditAfterCommit);
});
