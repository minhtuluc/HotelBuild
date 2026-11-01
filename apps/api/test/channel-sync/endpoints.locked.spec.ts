/**
 * HB-131 — test khoá giai đoạn A cho endpoint CHAN: sync, mappings, sales-closure, ota-bookings,
 * sync-status, outbox-deliveries, retry. Các tuyến chưa tồn tại ⇒ 404/405 nên mọi ca đỏ vì **hành vi
 * thiếu**, không vì lỗi import.
 *
 * Hợp đồng A (khớp HB-120): mappings dùng `If-Match` theo version kênh (thiếu ⇒ 428, lệch ⇒ 412);
 * sales-closure trả 200 `{channelId, rows:[{roomTypeId, date, closed, manual, automatic}]}` với `closed`
 * mặc định true; delivery retry trả 202 operationRef và giữ nguyên `(eventId, consumerKey)`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  FROM,
  TO,
  USERS,
  auth,
  booking,
  effects,
  http,
  login,
  monitoringFixtures,
  otaQueueFixtures,
  rows,
  seed,
  setup,
  teardown,
} from './fixture.js';
import {
  agodaChannel,
  closureRequest,
  currentEtag,
  mapping,
  mappingsRequest,
  otaChannel,
  readChannel,
  syncRequest,
} from './http.js';
import {
  closureViewSchema,
  errorBodySchema,
  outboxDeliveryListSchema,
  otaBookingListSchema,
  strictOperationRefSchema,
  syncStatusViewSchema,
} from './schemas.js';

vi.setConfig({ testTimeout: 60_000 });

let owner = '',
  manager = '',
  manager2 = '',
  frontDesk = '',
  accountant = '',
  housekeeping = '';

beforeAll(async () => {
  await setup();
  [owner, manager, manager2, frontDesk, accountant, housekeeping] = await Promise.all([
    login(USERS.owner),
    login(USERS.manager),
    login(USERS.manager2),
    login(USERS.frontDesk),
    login(USERS.accountant),
    login(USERS.housekeeping),
  ]);
}, 180_000);

afterAll(async () => {
  await teardown();
}, 60_000);

test('explicit-permissions-and-property-scope', async () => {
  const body = { scope: 'RANGE', from: FROM, to: TO };
  expect((await syncRequest(manager, body)).status).toBe(202);
  expect((await syncRequest(owner, body, randomUUID(), agodaChannel())).status).toBe(202);
  for (const token of [frontDesk, accountant, housekeeping])
    expect((await syncRequest(token, body)).status).toBe(403);

  // MANAGER chỉ sync được loại phòng trong cơ sở thuộc scope hiện tại (không nhận scope từ body/cursor).
  expect(
    (
      await syncRequest(manager2, {
        scope: 'RANGE',
        from: FROM,
        to: TO,
        roomTypeIds: [seed.typeId],
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await syncRequest(manager, {
        scope: 'RANGE',
        from: FROM,
        to: TO,
        roomTypeIds: [seed.otherTypeId],
      })
    ).status,
  ).toBe(403);

  // Ánh xạ cấu hình là quyền OWNER duy nhất; MANAGER không được tự mở.
  expect((await mappingsRequest(owner, mapping(), await currentEtag())).status).toBe(204);
  expect(
    (await mappingsRequest(manager, mapping({ roomTypeId: seed.dormTypeId }), await currentEtag()))
      .status,
  ).toBe(403);

  const closure = {
    roomTypeId: seed.typeId,
    from: '2027-03-10',
    to: '2027-03-11',
    reason: 'Bảo trì',
  };
  expect((await closureRequest(manager, closure)).status).toBe(200);
  expect((await closureRequest(owner, { ...closure, reason: 'Bảo trì theo lịch' })).status).toBe(
    200,
  );
  for (const token of [frontDesk, accountant, housekeeping])
    expect((await closureRequest(token, closure)).status).toBe(403);

  for (const path of ['ota-bookings', 'sync-status', 'outbox-deliveries'])
    for (const token of [manager, owner]) expect((await readChannel(token, path)).status).toBe(200);
  for (const path of ['ota-bookings', 'sync-status', 'outbox-deliveries'])
    for (const token of [frontDesk, accountant, housekeeping])
      expect((await readChannel(token, path)).status).toBe(403);
  expect((await http().get('/api/v1/channels').set(auth(manager))).status).toBe(200);
  expect((await http().get('/api/v1/channels').set(auth(frontDesk))).status).toBe(403);

  // Retry delivery: chỉ MANAGER/OWNER (kiểm quyền trước khi tra delivery).
  for (const token of [frontDesk, accountant])
    expect(
      (
        await http()
          .post(`/api/v1/channels/${otaChannel()}/outbox-deliveries/${randomUUID()}/retry`)
          .set(auth(token))
          .set('Idempotency-Key', randomUUID())
      ).status,
    ).toBe(403);
});

test('sync-operation-and-idempotency', async () => {
  const body = { scope: 'RANGE', from: FROM, to: TO };
  const key = randomUUID();
  const response = await syncRequest(manager, body, key);
  expect(response.status).toBe(202);
  const first = strictOperationRefSchema.parse(response.body);
  expect(first.status).toBe('PENDING');
  expect(first.statusUrl).toBe(`/api/v1/operations/${first.operationId}`);
  expect(response.headers.location).toBe(first.statusUrl);

  // Tra operation: người khởi tạo và OWNER đọc được; MANAGER khác bị từ chối (quyền hiện tại).
  expect((await http().get(first.statusUrl).set(auth(manager))).status).toBe(200);
  expect((await http().get(first.statusUrl).set(auth(owner))).status).toBe(200);
  expect((await http().get(first.statusUrl).set(auth(manager2))).status).toBe(403);

  // Cùng principal + operation + hash ⇒ replay đúng operation đã commit.
  const replay = await syncRequest(manager, body, key);
  expect(replay.status).toBe(202);
  expect(strictOperationRefSchema.parse(replay.body)).toEqual(first);
  expect(replay.headers.location).toBe(response.headers.location);

  // Cùng key nhưng payload khác ⇒ 409, không tạo operation thứ hai.
  expect((await syncRequest(manager, { scope: 'FULL' }, key)).status).toBe(409);

  // Khoá idempotency độc lập theo principal: MANAGER khác dùng cùng key vẫn tạo operation riêng.
  const other = await syncRequest(manager2, body, key, agodaChannel());
  expect(other.status).toBe(202);
  expect(strictOperationRefSchema.parse(other.body).operationId).not.toBe(first.operationId);
});

test('mapping-validation-and-atomicity', async () => {
  const before = await effects();
  const missing = await mappingsRequest(owner, mapping());
  expect(missing.status).toBe(428);
  expect(errorBodySchema.parse(missing.body).code).toBe('E_GEN_PRECONDITION_REQUIRED');
  const stale = await mappingsRequest(owner, mapping(), '"999999"');
  expect(stale.status).toBe(412);
  expect(errorBodySchema.parse(stale.body).code).toBe('E_GEN_VERSION_CONFLICT');
  expect(await effects()).toEqual(before);

  const valid = mapping({ roomTypeId: seed.dormTypeId, providerRoomTypeCode: 'DOR-OTA' });
  const ok = await mappingsRequest(owner, { ...valid, allotmentPct: 80 }, await currentEtag());
  expect(ok.status).toBe(204);
  expect(String(ok.headers.etag)).toMatch(/^"\d+"$/);
  expect(
    await rows(
      'SELECT external_room_code,status FROM channel_mappings WHERE channel_id=$1 AND room_type_id=$2',
      [otaChannel(), seed.dormTypeId],
    ),
  ).toEqual([{ external_room_code: 'DOR-OTA', status: 'ACTIVE' }]);
  const after = await effects();
  expect(after.mappings.length).toBe(before.mappings.length + 1);
  expect(after.audit).toBe(before.audit + 1);
  expect(after.outbox).toBe(before.outbox + 1);
  expect(after.completed).toBe(before.completed + 1);

  const beforeDuplicate = await effects();
  expect(
    (
      await mappingsRequest(
        owner,
        mapping({ roomTypeId: seed.typeId, providerRoomTypeCode: 'DOR-OTA' }),
        await currentEtag(),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await mappingsRequest(
        owner,
        { ...valid, providerRoomTypeCode: 'DOR-OTA-2', unexpected: 'x' },
        await currentEtag(),
      )
    ).status,
  ).toBe(400);
  // Loại phòng ngoài scope cơ sở ⇒ 403; allotmentPct sai miền ⇒ 400, không đổi used/tổng quota.
  expect(
    (
      await mappingsRequest(
        owner,
        mapping({ roomTypeId: seed.otherTypeId, providerRoomTypeCode: 'SUP-OTA' }),
        await currentEtag(),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await mappingsRequest(
        owner,
        mapping({ providerRoomTypeCode: 'STD-OTA-2', allotmentPct: 0 }),
        await currentEtag(),
      )
    ).status,
  ).toBe(400);
  expect(await effects()).toEqual(beforeDuplicate);
});

test('manual-closure-and-inbound-exemption', async () => {
  const bookingId = await booking({ code: 'PH-261101-CLS01', externalRef: 'OTA-CLOSE-1' });
  const closure = {
    roomTypeId: seed.typeId,
    from: '2027-03-20',
    to: '2027-03-21',
    reason: 'Bảo trì hệ thống',
  };
  const beforeClosure = await effects();
  const key = randomUUID();
  const first = await closureRequest(manager, closure, key);
  expect(first.status).toBe(200);
  const view = closureViewSchema.parse(first.body);
  expect(view.channelId).toBe(otaChannel());
  expect(view.rows).toHaveLength(1);
  expect(view.rows[0]).toMatchObject({
    roomTypeId: seed.typeId,
    date: '2027-03-20',
    closed: true,
    manual: { closed: true, reason: 'Bảo trì hệ thống' },
  });
  expect(view.rows[0]!.automatic.closed).toBe(false);
  expect(
    await rows(
      "SELECT is_closed,manual_closed,closed_by,closed_reason FROM channel_allotments WHERE channel_id=$1 AND date='2027-03-20'",
      [otaChannel()],
    ),
  ).toEqual([
    {
      is_closed: true,
      manual_closed: true,
      closed_by: seed.userIds[USERS.manager],
      closed_reason: 'Bảo trì hệ thống',
    },
  ]);
  const afterClose = await effects();
  expect(afterClose.audit).toBe(beforeClosure.audit + 1);
  expect(afterClose.outbox).toBe(beforeClosure.outbox + 1);

  // Replay cùng key/hash không nhân đôi audit/outbox/closure.
  expect((await closureRequest(manager, closure, key)).status).toBe(200);
  expect(await effects()).toEqual(afterClose);

  // Khoảng ngày không hợp lệ hoặc thiếu reason ⇒ 400.
  expect(
    (await closureRequest(manager, { ...closure, from: '2027-03-21', to: '2027-03-20' })).status,
  ).toBe(400);
  expect((await closureRequest(manager, { ...closure, reason: '' })).status).toBe(400);
  expect((await rows('SELECT status FROM bookings WHERE id=$1', [bookingId]))[0]!.status).toBe(
    'CONFIRMED',
  );
});

test('ota-queue-projection-and-stable-pagination', async () => {
  const { confirmed, duplicate, foreign } = await otaQueueFixtures();
  const query = { from: '2027-04-01', to: '2027-04-04' };
  const page = otaBookingListSchema.parse(
    (await readChannel(manager, 'ota-bookings').query(query)).body,
  );
  expect(page.data.map((row) => row.id).sort()).toEqual([confirmed, duplicate].sort());
  expect(page.data.map((row) => row.id)).not.toContain(foreign);
  expect(page.meta.hasMore).toBe(false);
  const serialized = JSON.stringify(page);
  for (const secret of [
    'SUPER-SECRET-SIGNATURE',
    'SUPER-SECRET-TOKEN',
    'secret@example.com',
    '+84900000001',
  ])
    expect(serialized).not.toContain(secret);

  const filtered = otaBookingListSchema.parse(
    (await readChannel(manager, 'ota-bookings').query({ ...query, q: 'OTA-QUEUE-2' })).body,
  );
  expect(filtered.data).toHaveLength(1);
  expect(filtered.data[0]).toMatchObject({ id: duplicate, duplicateSuspected: true });

  const foreignPage = otaBookingListSchema.parse(
    (await readChannel(manager2, 'ota-bookings').query(query)).body,
  );
  expect(foreignPage.data.map((row) => row.id)).toEqual([foreign]);

  const firstPage = otaBookingListSchema.parse(
    (await readChannel(manager, 'ota-bookings').query({ ...query, limit: 1 })).body,
  );
  expect(firstPage.data).toHaveLength(1);
  const cursor = firstPage.meta.nextCursor;
  expect(cursor).not.toBeNull();
  const firstIds = firstPage.data.map((row) => row.id);
  const secondPage = otaBookingListSchema.parse(
    (await readChannel(manager, 'ota-bookings').query({ ...query, limit: 1, cursor })).body,
  );
  expect(secondPage.data.map((row) => row.id)).not.toEqual(firstIds);
  const again = otaBookingListSchema.parse(
    (await readChannel(manager, 'ota-bookings').query({ ...query, limit: 1 })).body,
  );
  expect(again.data.map((row) => row.id)).toEqual(firstIds);
  expect(
    (
      await readChannel(manager, 'ota-bookings').query({
        from: '2027-04-01',
        to: '2027-04-03',
        limit: 1,
        cursor,
      })
    ).status,
  ).toBe(400);
});

test('monitoring_reads_and_authorized_delivery_retry', async () => {
  const { deadEvent, doneEvent } = await monitoringFixtures();
  const status = syncStatusViewSchema.parse((await readChannel(manager, 'sync-status')).body);
  expect(status).toMatchObject({
    channelId: otaChannel(),
    syncStatus: 'DEGRADED',
    consecutiveFailures: 3,
    lastError: 'E_CHAN_SYNC_FAILED',
  });
  expect(JSON.stringify(status)).not.toContain('SUPER-SECRET');

  const dead = outboxDeliveryListSchema.parse(
    (await readChannel(manager, 'outbox-deliveries').query({ status: 'DEAD_LETTER' })).body,
  );
  expect(dead.data).toHaveLength(1);
  const delivery = dead.data[0]!;
  expect(delivery).toMatchObject({
    eventId: deadEvent,
    consumerKey: 'channel-sync',
    status: 'DEAD_LETTER',
    attempts: 5,
    lastError: 'E_CHAN_SYNC_FAILED',
  });
  expect(JSON.stringify(dead)).not.toContain('payload_json');

  const retry = await http()
    .post(`/api/v1/channels/${otaChannel()}/outbox-deliveries/${delivery.id}/retry`)
    .set(auth(manager))
    .set('Idempotency-Key', randomUUID());
  expect(retry.status).toBe(202);
  const reference = strictOperationRefSchema.parse(retry.body);
  expect(retry.headers.location).toBe(reference.statusUrl);
  const deliveryRows = await rows(
    'SELECT event_id,consumer,status FROM event_deliveries WHERE event_id=$1 AND consumer=$2',
    [deadEvent, 'channel-sync'],
  );
  expect(deliveryRows).toHaveLength(1);
  expect(deliveryRows[0]).toMatchObject({ event_id: deadEvent, consumer: 'channel-sync' });
  expect(deliveryRows[0]!.status).not.toBe('COMPLETED');

  // Retry delivery đã COMPLETED ⇒ 409 và không đổi dữ liệu.
  const completed = outboxDeliveryListSchema.parse(
    (await readChannel(manager, 'outbox-deliveries').query({ status: 'COMPLETED' })).body,
  );
  const done = completed.data.find((row) => row.eventId === doneEvent);
  expect(done).toBeDefined();
  expect(
    (
      await http()
        .post(`/api/v1/channels/${otaChannel()}/outbox-deliveries/${done!.id}/retry`)
        .set(auth(manager))
        .set('Idempotency-Key', randomUUID())
    ).status,
  ).toBe(409);
});
